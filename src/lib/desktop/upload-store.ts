import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { desktopUploadJobs, pendingUploads, requestBudgets } from "@/db/schema";
import { appendAudit, auditFilename, type DbTransaction } from "@/lib/audit";
import { getBlobStoreConfig } from "@/lib/blob-store";
import {
  MAX_UPLOAD_BYTES,
  PENDING_UPLOAD_TTL_MS,
  UPLOAD_BUDGET,
} from "@/lib/limits";
import { hashNonce, replayPathname } from "@/lib/pending-upload";
import { budgetKey, consumeRequestBudgetsInTx } from "@/lib/request-budget";
import { isUuid } from "@/lib/validation";
import { lockDevice, type DeviceActor } from "./authority";
import {
  DesktopError,
  PROTOCOL,
  fingerprint,
  reservationNonce,
  validateUpload,
} from "./protocol";

export type Job = typeof desktopUploadJobs.$inferSelect;
export async function sessionInfo(actor: DeviceActor) {
  return db.transaction(async (tx) => {
    const { device } = await lockDevice(tx, actor, "replay:status");
    const now = new Date();
    const keys = [
      budgetKey("upload:account", actor.accountId),
      "upload:global",
    ];
    const counters = await tx
      .select()
      .from(requestBudgets)
      .where(inArray(requestBudgets.key, keys));
    function quota(key: string, limit: number) {
      const counter = counters.find((c) => c.key === key && c.resetAt > now);
      return {
        limit,
        remaining: Math.max(0, limit - (counter?.count ?? 0)),
        resetAt: counter?.resetAt.toISOString() ?? null,
      };
    }
    return {
      protocol: PROTOCOL,
      account: { name: actor.name, role: actor.role },
      deviceSessionId: device.id,
      deviceExpiresAt: device.expiresAt.toISOString(),
      maxUploadBytes: MAX_UPLOAD_BYTES,
      quota: {
        asOf: now.toISOString(),
        account: quota(keys[0], UPLOAD_BUDGET.perAccount),
        global: quota(keys[1], UPLOAD_BUDGET.global),
      },
    };
  });
}
export async function reserveUpload(
  actor: DeviceActor,
  input: unknown,
  key: string,
) {
  const data = validateUpload(input);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key))
    throw new DesktopError("invalid_idempotency_key");
  const digest = fingerprint(data),
    store = getBlobStoreConfig();
  return db.transaction(async (tx) => {
    const { device } = await lockDevice(tx, actor, "replay:upload");
    const [existing] = await tx
      .select()
      .from(desktopUploadJobs)
      .where(
        and(
          eq(desktopUploadJobs.deviceSessionId, device.id),
          eq(desktopUploadJobs.idempotencyKey, key),
        ),
      );
    if (existing) {
      if (existing.fingerprint !== digest)
        throw new DesktopError("idempotency_conflict", 409);
      if (
        existing.reservationExpiresAt.getTime() <= Date.now() ||
        existing.resultExpiresAt.getTime() <= Date.now()
      )
        throw new DesktopError("reservation_expired", 409);
      return binding(existing);
    }
    await consumeRequestBudgetsInTx(tx, [
      {
        key: budgetKey("upload:account", actor.accountId),
        limit: UPLOAD_BUDGET.perAccount,
        windowMs: UPLOAD_BUDGET.windowMs,
      },
      {
        key: "upload:global",
        limit: UPLOAD_BUDGET.global,
        windowMs: UPLOAD_BUDGET.windowMs,
      },
    ]);
    const id = crypto.randomUUID(),
      nonce = reservationNonce(device.id, id),
      pathname = replayPathname(id),
      now = Date.now(),
      expires = new Date(now + PENDING_UPLOAD_TTL_MS);
    await tx.insert(pendingUploads).values({
      id,
      nonceHash: hashNonce(nonce),
      pathname,
      channel: "desktop",
      deviceSessionId: device.id,
      actorRole: actor.role,
      actorAccountId: actor.accountId,
      actorDiscordUserId: actor.discordUserId,
      actorAdminGrantId: actor.adminGrantId,
      actorUploaderGrantId: actor.uploaderGrantId ?? null,
      actorName: actor.name,
      auditMetadata: { originalFilename: auditFilename(data.filename) },
      expiresAt: expires,
    });
    const [job] = await tx
      .insert(desktopUploadJobs)
      .values({
        id,
        deviceSessionId: device.id,
        accountId: actor.accountId,
        idempotencyKey: key,
        fingerprint: digest,
        nonceHash: hashNonce(nonce),
        filename: data.filename,
        size: data.size,
        lastModified: data.lastModified,
        clientSha256: data.clientSha256,
        storeOrigin: store.origin,
        pathname,
        reservationExpiresAt: expires,
        resultExpiresAt: new Date(now + 7 * 86_400_000),
        tombstoneExpiresAt: device.expiresAt,
      })
      .returning();
    await appendAudit(tx, actor, {
      action: "replay.reserved",
      targetType: "upload",
      targetId: id,
      requestId: id,
      after: {
        deviceSessionId: device.id,
        channel: "desktop",
        originalFilename: data.filename,
      },
    });
    return binding(job);
  });
}
function binding(job: Job) {
  return {
    uploadId: job.id,
    nonce: reservationNonce(job.deviceSessionId, job.id),
    expiresAt: job.reservationExpiresAt.toISOString(),
  };
}
export async function ownedJob(
  tx: DbTransaction,
  actor: DeviceActor,
  id: string,
  nonce?: string,
): Promise<Job> {
  if (!isUuid(id)) throw new DesktopError("not_found", 404);
  const [job] = await tx
    .select()
    .from(desktopUploadJobs)
    .where(
      and(
        eq(desktopUploadJobs.id, id),
        eq(desktopUploadJobs.deviceSessionId, actor.deviceSessionId),
      ),
    );
  if (!job) throw new DesktopError("not_found", 404);
  if (nonce !== undefined && hashNonce(nonce) !== job.nonceHash)
    throw new DesktopError("invalid_binding", 403);
  if (job.resultExpiresAt.getTime() <= Date.now())
    throw new DesktopError("reservation_expired", 409);
  return job;
}
export function jobResult(job: Job) {
  const expired =
    job.state === "processing" &&
    (!job.claimExpiresAt || job.claimExpiresAt.getTime() <= Date.now());
  return {
    uploadId: job.id,
    state: expired ? "outcome_unknown" : job.state,
    ...(job.result
      ? { ...job.result, gamePath: "/games/" + job.result.gameId }
      : {}),
    ...(job.errorCode ? { errorCode: job.errorCode } : {}),
    ...(expired ? { errorCode: "outcome_unknown" } : {}),
  };
}
export async function uploadStatus(actor: DeviceActor, id: string) {
  return db.transaction(async (tx) => {
    await lockDevice(tx, actor, "replay:status");
    return jobResult(await ownedJob(tx, actor, id));
  });
}
export function requirePending(job: Job) {
  if (job.reservationExpiresAt.getTime() <= Date.now())
    throw new DesktopError("reservation_expired", 409);
  if (job.state !== "pending") throw new DesktopError("upload_consumed", 409);
}
/** Lock order: actor/device/credential already held, then pending, then job. */
export async function lockJob(
  tx: DbTransaction,
  actor: DeviceActor,
  id: string,
  nonce: string,
) {
  await tx
    .select({ id: pendingUploads.id })
    .from(pendingUploads)
    .where(eq(pendingUploads.id, id))
    .for("update");
  await tx
    .select({ id: desktopUploadJobs.id })
    .from(desktopUploadJobs)
    .where(eq(desktopUploadJobs.id, id))
    .for("update");
  return ownedJob(tx, actor, id, nonce);
}
