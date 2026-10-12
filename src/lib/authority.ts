import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { adminGrants, authAccounts, authSessions } from "@/db/schema";
import { getAuthorityConfig, type Actor } from "@/lib/auth";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth-errors";
import type { DbTransaction } from "@/lib/audit";
import { isUuid } from "@/lib/validation";

export function accountRole(
  discordUserId: string,
  grantId: string | null,
): Actor["role"] {
  return discordUserId === getAuthorityConfig().ownerUserId
    ? "owner"
    : grantId
      ? "admin"
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
    .where(
      and(
        eq(authSessions.referenceHash, referenceHash),
        eq(authSessions.guildId, guildId),
        eq(authAccounts.guildId, guildId),
        eq(authAccounts.status, "active"),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return null;
  const role = accountRole(row.account.discordUserId, row.grantId);
  return {
    role,
    accountId: row.account.id,
    discordUserId: row.account.discordUserId,
    sessionId: row.session.id,
    adminGrantId: role === "admin" ? row.grantId : null,
    name: row.account.displayName,
  };
}
/** Account → session → grant; account SHARE is held until mutation commit. */
export async function lockActorAuthority(
  tx: DbTransaction,
  actor: Actor,
): Promise<void> {
  if (actor.role === "viewer") throw new ForbiddenError();
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
        eq(authSessions.accountId, account.id),
        eq(authSessions.guildId, guildId),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, new Date()),
      ),
    )
    .for("share");
  if (!session) throw new UnauthorizedError();
  if (actor.role === "owner") {
    if (account.discordUserId !== ownerUserId) throw new UnauthorizedError();
    return;
  }
  if (!isUuid(actor.adminGrantId) || account.discordUserId === ownerUserId)
    throw new UnauthorizedError();
  const [grant] = await tx
    .select({ id: adminGrants.id })
    .from(adminGrants)
    .where(
      and(
        eq(adminGrants.id, actor.adminGrantId),
        eq(adminGrants.accountId, account.id),
        isNull(adminGrants.revokedAt),
      ),
    )
    .for("share");
  if (!grant) throw new UnauthorizedError();
}
