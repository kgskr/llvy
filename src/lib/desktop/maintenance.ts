import "server-only";
import { and, asc, eq, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  authAccounts,
  authSessions,
  desktopAuthRequests,
  desktopCredentials,
  desktopSessions,
  desktopUploadJobs,
} from "@/db/schema";
import { maintenanceActor } from "@/lib/auth-store";
import { revokeDevicesInTx } from "./revoke";
import { cleanupExpiredAuthorizationRequests } from "./auth-request-cleanup";

/** No provider calls. Bounded batches retain refresh replay evidence until absolute expiry. */
export async function cleanupDesktopAuthentication() {
  const now = new Date();
  const deadline = Date.now() + 10_000;
  let examinedDevices = 0;
  const requests = await cleanupExpiredAuthorizationRequests(500);
  const eligible = sql`(
    exists (select 1 from desktop_credentials c where c.session_id = ${desktopSessions.id} and c.expires_at <= ${now})
    or exists (select 1 from desktop_upload_jobs j where j.device_session_id = ${desktopSessions.id} and j.result_expires_at <= ${now} and (j.filename is not null or j.tombstone_expires_at <= ${now}))
    or (${desktopSessions.expiresAt} <= ${now} and not exists (select 1 from desktop_upload_jobs j where j.device_session_id = ${desktopSessions.id}))
  )`;
  const accounts = await db
    .selectDistinct({ id: desktopSessions.accountId })
    .from(desktopSessions)
    .where(eligible)
    .orderBy(asc(desktopSessions.accountId))
    .limit(100);
  let credentials = 0,
    jobs = 0,
    devices = 0;
  for (const account of accounts) {
    if (examinedDevices >= 100 || Date.now() >= deadline) break;
    await db.transaction(async (tx) => {
      await tx
        .select({ id: authAccounts.id })
        .from(authAccounts)
        .where(eq(authAccounts.id, account.id))
        .for("update");
      await tx
        .select({ id: authSessions.id })
        .from(authSessions)
        .where(eq(authSessions.accountId, account.id))
        .orderBy(asc(authSessions.id))
        .for("update");
      const sessions = await tx
        .select()
        .from(desktopSessions)
        .where(and(eq(desktopSessions.accountId, account.id), eligible))
        .orderBy(asc(desktopSessions.id))
        .limit(100 - examinedDevices)
        .for("update");
      for (const device of sessions) {
        if (Date.now() >= deadline) break;
        examinedDevices++;
        // Every refresh record expires at the device's absolute deadline.
        const expired = await tx
          .select({ id: desktopCredentials.id })
          .from(desktopCredentials)
          .where(
            and(
              eq(desktopCredentials.sessionId, device.id),
              lte(desktopCredentials.expiresAt, now),
            ),
          )
          .orderBy(asc(desktopCredentials.id))
          .limit(100)
          .for("update");
        if (expired.length) {
          await tx.delete(desktopCredentials).where(
            inArray(
              desktopCredentials.id,
              expired.map((r) => r.id),
            ),
          );
          credentials += expired.length;
        }
        const old = await tx
          .select()
          .from(desktopUploadJobs)
          .where(
            and(
              eq(desktopUploadJobs.deviceSessionId, device.id),
              lte(desktopUploadJobs.resultExpiresAt, now),
              or(
                isNotNull(desktopUploadJobs.filename),
                lte(desktopUploadJobs.tombstoneExpiresAt, now),
              ),
            ),
          )
          .orderBy(asc(desktopUploadJobs.id))
          .limit(50)
          .for("update");
        for (const job of old) {
          if (Date.now() >= deadline) break;
          if (job.tombstoneExpiresAt <= now) {
            await tx
              .delete(desktopUploadJobs)
              .where(eq(desktopUploadJobs.id, job.id));
            jobs++;
          } else if (job.filename !== null)
            await tx
              .update(desktopUploadJobs)
              .set({
                filename: null,
                size: null,
                lastModified: null,
                clientSha256: null,
                serverSha256: null,
                result: null,
                errorCode: null,
                claimId: null,
                claimExpiresAt: null,
              })
              .where(eq(desktopUploadJobs.id, job.id));
        }
        if (device.expiresAt <= now) {
          const [job] = await tx
            .select({ id: desktopUploadJobs.id })
            .from(desktopUploadJobs)
            .where(eq(desktopUploadJobs.deviceSessionId, device.id))
            .limit(1);
          const [credential] = await tx
            .select({ id: desktopCredentials.id })
            .from(desktopCredentials)
            .where(eq(desktopCredentials.sessionId, device.id))
            .limit(1);
          if (!job && !credential) {
            await tx
              .delete(desktopSessions)
              .where(eq(desktopSessions.id, device.id));
            await tx.delete(authSessions).where(eq(authSessions.id, device.id));
            devices++;
          }
        }
      }
    });
  }
  return { requests, credentials, jobs, devices };
}
/** Operational drain prerequisite: disable issuance on ALL serving deployments first.
 * One transaction prevents old owner credentials becoming valid after a rollback.
 * This helper never revokes browser sessions or changes deployment settings. */
export async function revokeAllDesktopConnections() {
  if (process.env.DESKTOP_UPLOADER_ENABLED === "true")
    throw new Error("Disable desktop issuance before revocation");
  return db.transaction(async (tx) => {
    const accounts = await tx
      .select({ id: authAccounts.id })
      .from(authAccounts)
      .orderBy(asc(authAccounts.id))
      .for("update");
    await tx
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(eq(authSessions.kind, "desktop"))
      .orderBy(asc(authSessions.id))
      .for("update");
    for (const account of accounts)
      await revokeDevicesInTx(tx, account.id, maintenanceActor);
    const requests = await tx
      .update(desktopAuthRequests)
      .set({ status: "revoked", codeHash: null })
      .where(inArray(desktopAuthRequests.status, ["pending", "approved"]))
      .returning({ id: desktopAuthRequests.id });
    return { accounts: accounts.length, requests: requests.length };
  });
}
