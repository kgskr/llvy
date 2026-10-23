import "server-only";
import { UnauthorizedError, ForbiddenError } from "@/lib/auth-errors";
import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { desktopUploadJobs, pendingUploads } from "@/db/schema";
import { appendAudit, type DbTransaction } from "@/lib/audit";
import { ingestReplay, type IngestResult } from "@/lib/ingest";
import { recordUploadFailure } from "@/lib/upload-failure";
import { RoflParseError } from "@/lib/rofl/parser";
import { lockDevice, type DeviceActor } from "./authority";
import { limitedBytes, readBoundObject, transferDescriptor } from "./blob";
import { DesktopError } from "./protocol";
import {
  jobResult,
  lockJob,
  ownedJob,
  requirePending,
  uploadStatus,
  type Job,
} from "./upload-store";

async function pendingJob(actor: DeviceActor, id: string, nonce: string) {
  return db.transaction(async (tx) => {
    await lockDevice(tx, actor, "replay:upload");
    const job = await ownedJob(tx, actor, id, nonce);
    requirePending(job);
    return job;
  });
}
export async function authorizeTransfer(
  actor: DeviceActor,
  id: string,
  nonce: string,
) {
  const job = await pendingJob(actor, id, nonce);
  const descriptor = await transferDescriptor(job);
  // Do not retain authority locks across the signing API call.
  await pendingJob(actor, id, nonce);
  return descriptor;
}
export function ingestionFinalizer(
  actor: DeviceActor,
  id: string,
  nonce: string,
  claim: string,
) {
  async function verify(tx: DbTransaction) {
    await lockDevice(tx, actor, "replay:upload");
    const job = await lockJob(tx, actor, id, nonce);
    if (
      job.state !== "processing" ||
      job.claimId !== claim ||
      !job.claimExpiresAt ||
      job.claimExpiresAt.getTime() <= Date.now() ||
      job.reservationExpiresAt.getTime() <= Date.now()
    )
      throw new DesktopError("outcome_unknown", 409);
    return job;
  }
  return {
    lock: async (tx: DbTransaction) => {
      await verify(tx);
    },
    finalize: async (
      tx: DbTransaction,
      result: IngestResult,
      serverSha256: string,
    ) => {
      const job = await verify(tx);
      if (job.clientSha256 !== serverSha256)
        throw new DesktopError("file_mismatch", 422);
      const rows = await tx
        .update(pendingUploads)
        .set({ state: "processed" })
        .where(
          and(
            eq(pendingUploads.id, id),
            eq(pendingUploads.state, "processing"),
            eq(pendingUploads.deviceSessionId, actor.deviceSessionId),
            eq(pendingUploads.channel, "desktop"),
            gt(pendingUploads.expiresAt, new Date()),
          ),
        )
        .returning({ id: pendingUploads.id });
      if (!rows.length) throw new DesktopError("outcome_unknown", 409);
      await tx
        .update(desktopUploadJobs)
        .set({
          state: result.duplicate ? "duplicate" : "completed",
          result,
          serverSha256,
          claimId: null,
          claimExpiresAt: null,
        })
        .where(eq(desktopUploadJobs.id, id));
      await appendAudit(tx, actor, {
        action: "replay.processed",
        targetType: "upload",
        targetId: id,
        requestId: id,
        result: result.duplicate ? "duplicate" : "success",
        after: {
          gameId: result.gameId,
          originalFilename: job.filename,
          fileHash: serverSha256,
          deviceSessionId: actor.deviceSessionId,
          channel: "desktop",
        },
      });
    },
  };
}
async function failClaim(
  actor: DeviceActor,
  job: Job,
  nonce: string,
  code: string,
  serverSha256?: string,
) {
  if (!job.claimId) return;
  await recordUploadFailure({
    uploadId: job.id,
    nonce,
    actor,
    reason: code,
    originalFilename: job.filename,
    fileHash: serverSha256,
    desktop: {
      deviceSessionId: actor.deviceSessionId,
      claimId: job.claimId,
    },
  });
}
export async function processUpload(
  actor: DeviceActor,
  id: string,
  nonce: string,
) {
  const initial = await db.transaction(async (tx) => {
    await lockDevice(tx, actor, "replay:upload");
    return ownedJob(tx, actor, id, nonce);
  });
  if (initial.state !== "pending") return jobResult(initial);
  requirePending(initial);
  let head: Response;
  try {
    head = await readBoundObject(initial, "HEAD");
  } catch {
    throw new DesktopError("storage_unavailable", 503);
  }
  if (head.status === 404) throw new DesktopError("object_not_uploaded", 409);
  if (!head.ok) throw new DesktopError("storage_unavailable", 503);
  const claimed = await db.transaction(async (tx) => {
    await lockDevice(tx, actor, "replay:upload");
    const job = await lockJob(tx, actor, id, nonce);
    if (job.state !== "pending") return job;
    requirePending(job);
    const claimId = crypto.randomUUID(),
      claimExpiresAt = new Date(
        Math.min(Date.now() + 120_000, job.reservationExpiresAt.getTime()),
      );
    const rows = await tx
      .update(pendingUploads)
      .set({
        state: "processing",
        blobUrl: `${job.storeOrigin}/${job.pathname}`,
      })
      .where(
        and(
          eq(pendingUploads.id, id),
          eq(pendingUploads.channel, "desktop"),
          eq(pendingUploads.deviceSessionId, actor.deviceSessionId),
          eq(pendingUploads.state, "pending"),
          gt(pendingUploads.expiresAt, new Date()),
        ),
      )
      .returning({ id: pendingUploads.id });
    if (!rows.length) throw new DesktopError("reservation_expired", 409);
    await tx
      .update(desktopUploadJobs)
      .set({ state: "processing", claimId, claimExpiresAt })
      .where(eq(desktopUploadJobs.id, id));
    return {
      ...job,
      state: "processing",
      claimId,
      claimExpiresAt,
      claimedNow: true,
    };
  });
  if (!("claimedNow" in claimed)) return jobResult(claimed);
  let bytes: Uint8Array;
  let serverSha256: string | undefined;
  try {
    const response = await readBoundObject(claimed, "GET");
    if (!response.ok) throw new DesktopError("download_failed", 502);
    bytes = await limitedBytes(response, claimed.size!);
    serverSha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== claimed.size || serverSha256 !== claimed.clientSha256)
      throw new DesktopError("file_mismatch", 422);
  } catch (error) {
    await failClaim(
      actor,
      claimed,
      nonce,
      error instanceof DesktopError ? error.code : "download_failed",
      serverSha256,
    );
    throw error;
  }
  try {
    await ingestReplay({
      bytes,
      blobUrl: `${claimed.storeOrigin}/${claimed.pathname}`,
      originalFilename: claimed.filename,
      lastModified: claimed.lastModified,
      actor,
      uploadId: id,
      desktop: ingestionFinalizer(actor, id, nonce, claimed.claimId!),
    });
  } catch (error) {
    if (error instanceof RoflParseError) {
      await failClaim(actor, claimed, nonce, "invalid_replay", serverSha256);
      throw new DesktopError("invalid_replay", 422);
    }
    if (
      error instanceof UnauthorizedError ||
      error instanceof ForbiddenError ||
      (error instanceof DesktopError &&
        ["authority_revoked", "invalid_token", "desktop_disabled"].includes(
          error.code,
        ))
    ) {
      await failClaim(actor, claimed, nonce, "authority_revoked", serverSha256);
      throw error;
    }
    // Unknown COMMIT outcomes must preserve both the object and any committed result.
    // A subsequent status request resolves success; expired claims report unknown.
    if (
      error instanceof DesktopError ||
      error instanceof UnauthorizedError ||
      error instanceof ForbiddenError
    )
      throw error;
    throw new DesktopError("outcome_unknown", 503);
  }
  // Exact orphan cleanup is delegated to existing bounded maintenance. Never
  // delete a canonical object on a transport exception or repeat result reads.
  return uploadStatus(actor, id);
}
