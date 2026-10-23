import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  authSessions,
  desktopAuthRequests,
  desktopCredentials,
  desktopSessions,
  desktopUploadJobs,
  pendingUploads,
} from "@/db/schema";
import { appendAudit, type DbTransaction } from "@/lib/audit";
import type { AuditActorSnapshot } from "@/lib/auth";

/** Caller holds account UPDATE and session/grant locks. Completed history is preserved. */
export async function revokeDevicesInTx(
  tx: DbTransaction,
  accountId: string,
  actor: AuditActorSnapshot,
  onlyIds?: string[],
) {
  const now = new Date();
  const devices = await tx
    .select()
    .from(desktopSessions)
    .where(
      and(
        eq(desktopSessions.accountId, accountId),
        isNull(desktopSessions.revokedAt),
        onlyIds ? inArray(desktopSessions.id, onlyIds) : undefined,
      ),
    )
    .orderBy(asc(desktopSessions.id))
    .for("update");
  if (!onlyIds)
    await tx
      .update(desktopAuthRequests)
      .set({ status: "revoked", codeHash: null })
      .where(
        and(
          eq(desktopAuthRequests.accountId, accountId),
          inArray(desktopAuthRequests.status, ["pending", "approved"]),
        ),
      );
  for (const device of devices) {
    await tx
      .update(authSessions)
      .set({ revokedAt: now })
      .where(eq(authSessions.id, device.id));
    await tx
      .update(desktopSessions)
      .set({ revokedAt: now })
      .where(eq(desktopSessions.id, device.id));
    await tx
      .select({ id: desktopCredentials.id })
      .from(desktopCredentials)
      .where(eq(desktopCredentials.sessionId, device.id))
      .orderBy(asc(desktopCredentials.id))
      .for("update");
    await tx
      .update(desktopCredentials)
      .set({ revokedAt: now })
      .where(eq(desktopCredentials.sessionId, device.id));
    await tx
      .update(pendingUploads)
      .set({ state: "failed" })
      .where(
        and(
          eq(pendingUploads.deviceSessionId, device.id),
          inArray(pendingUploads.state, ["pending", "processing"]),
        ),
      );
    await tx
      .update(desktopUploadJobs)
      .set({
        state: "failed",
        errorCode: "authority_revoked",
        // Preserve a processing worker's claim identity so it can retain an
        // observed failure/hash after revocation; failed state blocks ingestion.
        claimExpiresAt: null,
      })
      .where(
        and(
          eq(desktopUploadJobs.deviceSessionId, device.id),
          inArray(desktopUploadJobs.state, ["pending", "processing"]),
        ),
      );
    await appendAudit(tx, actor, {
      action: "desktop.revoked",
      targetType: "device",
      targetId: device.id,
      after: {
        deviceSessionId: device.id,
        channel: "desktop",
        mode: device.mode as "transient" | "persistent",
      },
    });
  }
}
