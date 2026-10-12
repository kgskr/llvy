import "server-only";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
} from "drizzle-orm";
import { db } from "@/db";
import { adminGrants, authAccounts, authSessions } from "@/db/schema";
import { appendAudit, lockActor, type DbTransaction } from "@/lib/audit";
import { accountRole } from "@/lib/authority";
import { getAuthorityConfig } from "@/lib/auth";
import { applyMembership, saveMembership } from "@/lib/auth-store";
import { lookupGuildMember } from "@/lib/discord";
import { assertOwner } from "@/lib/session";
import { isUuid } from "@/lib/validation";

export class AccountNotFoundError extends Error {}
export class GrantConflictError extends Error {}
export class AccountIneligibleError extends Error {}
async function lockAccounts(tx: DbTransaction, ids: string[]) {
  return tx
    .select()
    .from(authAccounts)
    .where(inArray(authAccounts.id, [...new Set(ids)].sort()))
    .orderBy(asc(authAccounts.id))
    .for("update");
}
export async function listLoginAccounts(search = "", limit = 50, offset = 0) {
  await assertOwner();
  const text = search.slice(0, 64).replace(/[\\%_]/g, "\\$&");
  const filter = text
    ? or(
        ilike(authAccounts.username, "%" + text + "%"),
        ilike(authAccounts.displayName, "%" + text + "%"),
        ilike(authAccounts.discordUserId, "%" + text + "%"),
      )
    : undefined;
  const [{ total }] = await db
    .select({ total: count() })
    .from(authAccounts)
    .where(filter);
  const rows = await db
    .select({
      id: authAccounts.id,
      discordUserId: authAccounts.discordUserId,
      username: authAccounts.username,
      displayName: authAccounts.displayName,
      lastLoginAt: authAccounts.lastLoginAt,
      status: authAccounts.status,
      membershipStatus: authAccounts.membershipStatus,
      membershipCheckedAt: authAccounts.membershipCheckedAt,
      grantId: adminGrants.id,
    })
    .from(authAccounts)
    .leftJoin(
      adminGrants,
      and(
        eq(adminGrants.accountId, authAccounts.id),
        isNull(adminGrants.revokedAt),
      ),
    )
    .where(filter)
    .orderBy(desc(authAccounts.lastLoginAt), asc(authAccounts.id))
    .limit(Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 50)
    .offset(Number.isSafeInteger(offset) ? Math.max(0, offset) : 0);
  return {
    total,
    accounts: rows.map((row) => ({
      ...row,
      role:
        row.status === "active"
          ? accountRole(row.discordUserId, row.grantId)
          : null,
    })),
  };
}
export async function grantAdministrator(accountId: string): Promise<string> {
  const actor = await assertOwner();
  if (!isUuid(accountId)) throw new AccountNotFoundError();
  const [target] = await db
    .select()
    .from(authAccounts)
    .where(eq(authAccounts.id, accountId));
  if (!target) throw new AccountNotFoundError();
  if (
    target.status !== "active" ||
    target.discordUserId === getAuthorityConfig().ownerUserId
  )
    throw new AccountIneligibleError();
  const check = await lookupGuildMember(target.discordUserId);
  if (check.status !== "member") {
    await saveMembership(check, actor);
    throw new AccountIneligibleError();
  }
  return db.transaction(async (tx) => {
    const rows = await lockAccounts(tx, [actor.accountId, accountId]);
    await lockActor(tx, actor);
    const current = rows.find((row) => row.id === accountId);
    if (!current) throw new AccountNotFoundError();
    if (
      current.status !== "active" ||
      current.discordUserId === getAuthorityConfig().ownerUserId
    )
      throw new AccountIneligibleError();
    if (!(await applyMembership(tx, current, check, actor)))
      throw new AccountIneligibleError();
    const [existing] = await tx
      .select({ id: adminGrants.id })
      .from(adminGrants)
      .where(
        and(
          eq(adminGrants.accountId, accountId),
          isNull(adminGrants.revokedAt),
        ),
      );
    if (existing) throw new GrantConflictError();
    const [grant] = await tx
      .insert(adminGrants)
      .values({ accountId, issuedBy: actor.accountId })
      .returning({ id: adminGrants.id });
    await appendAudit(tx, actor, {
      action: "admin.granted",
      targetType: "login_account",
      targetId: accountId,
      after: { administrator: true },
    });
    return grant.id;
  });
}
export async function revokeAdministrator(accountId: string): Promise<boolean> {
  const actor = await assertOwner();
  if (!isUuid(accountId)) throw new AccountNotFoundError();
  return db.transaction(async (tx) => {
    const rows = await lockAccounts(tx, [actor.accountId, accountId]);
    await lockActor(tx, actor);
    const target = rows.find((row) => row.id === accountId);
    if (!target) throw new AccountNotFoundError();
    if (target.discordUserId === getAuthorityConfig().ownerUserId)
      throw new AccountIneligibleError();
    const now = new Date();
    // Keep lock order account → sessions → grant, shared with actor validation.
    await tx
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(eq(authSessions.accountId, accountId))
      .orderBy(asc(authSessions.id))
      .for("update");
    const grants = await tx
      .update(adminGrants)
      .set({ revokedAt: now, revokedBy: actor.accountId })
      .where(
        and(
          eq(adminGrants.accountId, accountId),
          isNull(adminGrants.revokedAt),
        ),
      )
      .returning({ id: adminGrants.id });
    if (!grants.length) return false;
    await tx
      .update(authSessions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(authSessions.accountId, accountId),
          isNull(authSessions.revokedAt),
        ),
      );
    await appendAudit(tx, actor, {
      action: "admin.revoked",
      targetType: "login_account",
      targetId: accountId,
      before: { administrator: true },
      after: { administrator: false },
    });
    return true;
  });
}
