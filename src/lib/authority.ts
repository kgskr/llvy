import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  adminGrants,
  uploaderGrants,
  authAccounts,
  authSessions,
} from "@/db/schema";
import { getAuthorityConfig, type Actor } from "@/lib/auth";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth-errors";
import type { DbTransaction } from "@/lib/audit";
import { canManage, canUpload } from "@/lib/capabilities";
import { isUuid } from "@/lib/validation";

export function accountRole(
  discordUserId: string,
  grantId: string | null,
  uploaderGrantId: string | null = null,
): Actor["role"] {
  return discordUserId === getAuthorityConfig().ownerUserId
    ? "owner"
    : grantId
      ? "admin"
      : uploaderGrantId
        ? "uploader"
        : "viewer";
}
export async function findSessionActor(
  referenceHash: string,
): Promise<Actor | null> {
  const { guildId } = getAuthorityConfig();
  const [row] = await db
    .select({
      account: authAccounts,
      session: authSessions,
      grantId: adminGrants.id,
      uploaderGrantId: uploaderGrants.id,
    })
    .from(authSessions)
    .innerJoin(authAccounts, eq(authAccounts.id, authSessions.accountId))
    .leftJoin(
      adminGrants,
      and(
        eq(adminGrants.accountId, authAccounts.id),
        isNull(adminGrants.revokedAt),
      ),
    )
    .leftJoin(
      uploaderGrants,
      and(
        eq(uploaderGrants.accountId, authAccounts.id),
        isNull(uploaderGrants.revokedAt),
      ),
    )
    .where(
      and(
        eq(authSessions.referenceHash, referenceHash),
        eq(authSessions.kind, "browser"),
        eq(authSessions.guildId, guildId),
        eq(authAccounts.guildId, guildId),
        eq(authAccounts.status, "active"),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return null;
  const role = accountRole(
    row.account.discordUserId,
    row.grantId,
    row.uploaderGrantId,
  );
  return {
    role,
    accountId: row.account.id,
    discordUserId: row.account.discordUserId,
    sessionId: row.session.id,
    adminGrantId: role === "admin" ? row.grantId : null,
    uploaderGrantId: role === "uploader" ? row.uploaderGrantId : null,
    name: row.account.displayName,
  };
}
/** Account → session → grant; account SHARE is held until mutation commit. */
export async function lockActorAuthority(
  tx: DbTransaction,
  actor: Actor,
  kind: "browser" | "desktop" = "browser",
): Promise<void> {
  return lockAuthority(tx, actor, kind, "management");
}
export async function lockBrowserIdentity(tx: DbTransaction, actor: Actor) {
  return lockAuthority(tx, actor, "browser", "identity");
}
async function lockAuthority(
  tx: DbTransaction,
  actor: Actor,
  kind: "browser" | "desktop",
  capability: "identity" | "management" | "upload",
): Promise<void> {
  if (capability === "management" && !canManage(actor.role))
    throw new ForbiddenError();
  if (capability === "upload" && !canUpload(actor.role))
    throw new ForbiddenError();
  if (!isUuid(actor.accountId) || !isUuid(actor.sessionId))
    throw new UnauthorizedError();
  const { guildId, ownerUserId } = getAuthorityConfig();
  const [account] = await tx
    .select()
    .from(authAccounts)
    .where(eq(authAccounts.id, actor.accountId))
    .for("share");
  if (
    !account ||
    account.status !== "active" ||
    account.guildId !== guildId ||
    account.discordUserId !== actor.discordUserId
  )
    throw new UnauthorizedError();
  const [session] = await tx
    .select({ id: authSessions.id })
    .from(authSessions)
    .where(
      and(
        eq(authSessions.id, actor.sessionId),
        eq(authSessions.kind, kind),
        eq(authSessions.accountId, account.id),
        eq(authSessions.guildId, guildId),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, new Date()),
      ),
    )
    .for("share");
  if (!session) throw new UnauthorizedError();
  if (capability === "identity") return;
  if (actor.role === "owner") {
    if (account.discordUserId !== ownerUserId) throw new UnauthorizedError();
    return;
  }
  if (actor.role === "uploader") {
    const [higherGrant] = await tx
      .select({ id: adminGrants.id })
      .from(adminGrants)
      .where(
        and(
          eq(adminGrants.accountId, account.id),
          isNull(adminGrants.revokedAt),
        ),
      );
    if (higherGrant || actor.adminGrantId) throw new UnauthorizedError();
  } else if (actor.uploaderGrantId) throw new UnauthorizedError();
  const table = actor.role === "uploader" ? uploaderGrants : adminGrants;
  const grantId =
    actor.role === "uploader" ? actor.uploaderGrantId : actor.adminGrantId;
  if (!isUuid(grantId) || account.discordUserId === ownerUserId)
    throw new UnauthorizedError();
  const [grant] = await tx
    .select({ id: table.id })
    .from(table)
    .where(
      and(
        eq(table.id, grantId),
        eq(table.accountId, account.id),
        isNull(table.revokedAt),
      ),
    )
    .for("share");
  if (!grant) throw new UnauthorizedError();
}

export async function lockUploadAuthority(
  tx: DbTransaction,
  actor: Actor,
  kind: "browser" | "desktop" = "browser",
) {
  return lockAuthority(tx, actor, kind, "upload");
}
