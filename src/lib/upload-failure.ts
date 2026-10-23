import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, desktopUploadJobs, pendingUploads } from "@/db/schema";
import type { Actor } from "@/lib/auth";
import { appendAudit, auditFilename, type DbTransaction } from "@/lib/audit";
import { hashNonce } from "@/lib/pending-upload";

/** Only the worker which already claimed this reservation may retain its failure.
 * This records history, so revoked authority must not block it. No Blob or game
 * authority is granted here. Unknown transaction outcomes must not call this. */
export async function recordUploadFailure(input: {
  uploadId: string;
  nonce: string;
  actor: Actor;
  reason: string;
  originalFilename: string | null;
  fileHash?: string;
  desktop?: { deviceSessionId: string; claimId: string };
}): Promise<void> {
  const { actor, desktop } = input;
  async function lockClaim(tx: DbTransaction) {
    const [row] = await tx
      .select()
      .from(pendingUploads)
      .where(eq(pendingUploads.id, input.uploadId))
      .for("update");
    if (
      !row ||
      // Membership suspension may retire an already claimed browser upload.
      // Its nonce, stored Blob binding and absent terminal event prove this
      // worker may still record history, but never authorize another ingest.
      (row.state !== "processing" &&
        !(row.state === "failed" && (desktop || row.blobUrl))) ||
      row.nonceHash !== hashNonce(input.nonce) ||
      row.actorAccountId !== actor.accountId ||
      row.actorRole !== actor.role ||
      row.actorDiscordUserId !== actor.discordUserId ||
      row.actorAdminGrantId !== actor.adminGrantId ||
      row.actorUploaderGrantId !== (actor.uploaderGrantId ?? null) ||
      row.channel !== (desktop ? "desktop" : "browser") ||
      row.deviceSessionId !== (desktop?.deviceSessionId ?? null)
    )
      return null;
    if (desktop) {
      const [job] = await tx
        .select()
        .from(desktopUploadJobs)
        .where(eq(desktopUploadJobs.id, row.id))
        .for("update");
      if (
        !job ||
        (job.state !== "processing" &&
          !(job.state === "failed" && job.errorCode === "authority_revoked")) ||
        job.claimId !== desktop.claimId ||
        job.deviceSessionId !== desktop.deviceSessionId ||
        job.accountId !== actor.accountId ||
        job.nonceHash !== hashNonce(input.nonce) ||
        row.nonceHash !== job.nonceHash
      )
        return null;
    }
    const [terminal] = await tx
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, "replay.processed"),
          eq(auditLogs.requestId, row.id),
        ),
      )
      .limit(1);
    return terminal ? null : row;
  }
  // Commit the observed metadata separately: an audit-insert outage must not
  // erase a known parse/authority failure or an already computed server hash.
  const retained = await db.transaction(async (tx) => {
    const row = await lockClaim(tx);
    if (!row) return false;
    const metadata = {
      originalFilename:
        auditFilename(input.originalFilename) ??
        row.auditMetadata?.originalFilename ??
        null,
      failure: row.auditMetadata?.failure ?? {
        reason: input.reason.slice(0, 256).replace(/\x00/g, "").toWellFormed(),
        ...(/^[a-f0-9]{64}$/.test(input.fileHash ?? "")
          ? { fileHash: input.fileHash! }
          : {}),
      },
    };
    await tx
      .update(pendingUploads)
      .set({ auditMetadata: metadata })
      .where(eq(pendingUploads.id, row.id));
    return true;
  });
  if (!retained) return;
  await db.transaction(async (tx) => {
    const row = await lockClaim(tx);
    const metadata = row?.auditMetadata;
    if (!row || !metadata?.failure) return;
    const recorded = await appendAudit(
      tx,
      {
        role: actor.role,
        accountId: row.actorAccountId,
        discordUserId: row.actorDiscordUserId,
        adminGrantId: row.actorAdminGrantId,
        uploaderGrantId: row.actorUploaderGrantId,
        memberId: row.actorMemberId,
        credentialId: row.actorCredentialId,
        name: row.actorName ?? actor.name,
      },
      {
        action: "replay.processed",
        targetType: "upload",
        targetId: row.id,
        requestId: row.id,
        result: "failure",
        after: {
          ...metadata.failure,
          originalFilename: metadata.originalFilename,
          channel: desktop ? "desktop" : "browser",
          ...(desktop ? { deviceSessionId: desktop.deviceSessionId } : {}),
        },
      },
    );
    if (!recorded) return;
    await tx
      .update(pendingUploads)
      .set({ state: "failed" })
      .where(eq(pendingUploads.id, row.id));
    if (desktop)
      await tx
        .update(desktopUploadJobs)
        .set({
          state: "failed",
          errorCode: metadata.failure.reason,
          serverSha256: metadata.failure.fileHash ?? null,
          claimId: null,
          claimExpiresAt: null,
        })
        .where(eq(desktopUploadJobs.id, row.id));
  });
}
