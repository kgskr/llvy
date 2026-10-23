import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { authAccounts, desktopCredentials, desktopSessions } from "@/db/schema";
import type { Actor } from "@/lib/auth";
import type { DbTransaction } from "@/lib/audit";
import { lockUploadAuthority } from "@/lib/authority";
import {
  DesktopError,
  requireDesktop,
  secretHash,
  validToken,
} from "./protocol";

export type DeviceActor = Actor & {
  deviceSessionId: string;
  credentialId: string;
  credentialKind: "access" | "refresh";
};
export async function credentialActor(
  value: string,
  kind: "access" | "refresh",
): Promise<DeviceActor> {
  if (!validToken(value, kind)) throw new DesktopError("invalid_token", 401);
  const [row] = await db
    .select({
      device: desktopSessions,
      credential: desktopCredentials,
      account: authAccounts,
    })
    .from(desktopCredentials)
    .innerJoin(
      desktopSessions,
      eq(desktopSessions.id, desktopCredentials.sessionId),
    )
    .innerJoin(authAccounts, eq(authAccounts.id, desktopSessions.accountId))
    .where(
      and(
        eq(desktopCredentials.tokenHash, secretHash(kind, value)),
        eq(desktopCredentials.kind, kind),
      ),
    )
    .limit(1);
  if (!row) throw new DesktopError("invalid_token", 401);
  return {
    role: row.device.role as Actor["role"],
    accountId: row.account.id,
    discordUserId: row.account.discordUserId,
    name: row.account.displayName,
    sessionId: row.device.id,
    adminGrantId: row.device.grantId,
    uploaderGrantId: row.device.uploaderGrantId,
    deviceSessionId: row.device.id,
    credentialId: row.credential.id,
    credentialKind: kind,
  };
}
export async function lockDevice(
  tx: DbTransaction,
  actor: DeviceActor,
  scope: "replay:upload" | "replay:status" | "revoke",
  options: { allowDisabled?: boolean; allowConsumed?: boolean } = {},
) {
  if (!options.allowDisabled) requireDesktop();
  await lockUploadAuthority(tx, actor, "desktop");
  const [device] = await tx
    .select()
    .from(desktopSessions)
    .where(eq(desktopSessions.id, actor.deviceSessionId))
    .for("update");
  const now = Date.now();
  if (
    !device ||
    device.accountId !== actor.accountId ||
    device.revokedAt ||
    device.expiresAt.getTime() <= now ||
    device.role !== actor.role ||
    device.grantId !== actor.adminGrantId ||
    device.uploaderGrantId !== (actor.uploaderGrantId ?? null) ||
    (scope !== "revoke" && !device.scopes.split(" ").includes(scope))
  )
    throw new DesktopError("authority_revoked", 403);
  const [credential] = await tx
    .select()
    .from(desktopCredentials)
    .where(
      and(
        eq(desktopCredentials.id, actor.credentialId),
        eq(desktopCredentials.sessionId, device.id),
        eq(desktopCredentials.kind, actor.credentialKind),
      ),
    )
    .for("share");
  if (
    !credential ||
    credential.revokedAt ||
    credential.expiresAt.getTime() <= now ||
    (credential.consumedAt && !options.allowConsumed)
  )
    throw new DesktopError("invalid_token", 401);
  return { device, credential };
}
