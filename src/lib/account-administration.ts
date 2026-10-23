import "server-only";
import { revokeDevicesInTx } from "@/lib/desktop/revoke";
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
import {
  adminGrants,
  uploaderGrants,
  authAccounts,
  authSessions,
} from "@/db/schema";
import { appendAudit, lockActor, type DbTransaction } from "@/lib/audit";
import { accountRole } from "@/lib/authority";
import { getAuthorityConfig, type Actor } from "@/lib/auth";
import { applyMembership } from "@/lib/auth-store";
import { lookupGuildMember } from "@/lib/discord";
import { assertAdmin, assertOwner, assertReadAdmin } from "@/lib/session";
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
  await assertReadAdmin();
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
      uploaderGrantId: uploaderGrants.id,
    })
    .from(authAccounts)
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
          ? accountRole(row.discordUserId, row.grantId, row.uploaderGrantId)
          : null,
    })),
  };
}
type GrantKind = "admin" | "uploader";

async function lockTargetSessions(tx: DbTransaction, accountId: string) {
  await tx
    .select({ id: authSessions.id })
    .from(authSessions)
    .where(eq(authSessions.accountId, accountId))
    .orderBy(asc(authSessions.id))
    .for("update");
}
async function invalidateTargetSessions(
  tx: DbTransaction,
  accountId: string,
  actor: Actor,
) {
  await tx
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(authSessions.accountId, accountId),
        isNull(authSessions.revokedAt),
      ),
    );
  await revokeDevicesInTx(tx, accountId, actor);
}
async function grantRole(accountId: string, kind: GrantKind): Promise<string> {
  const actor = await (kind === "admin" ? assertOwner() : assertAdmin());
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
  if (kind === "uploader") {
    const [admin] = await db
      .select({ id: adminGrants.id })
      .from(adminGrants)
      .where(
        and(
          eq(adminGrants.accountId, accountId),
          isNull(adminGrants.revokedAt),
        ),
      );
    if (admin) throw new AccountIneligibleError();
  }
  const check = await lookupGuildMember(target.discordUserId);
  const result = await db.transaction(async (tx) => {
    const rows = await lockAccounts(tx, [actor.accountId, accountId]);
    await lockActor(tx, actor);
    const current = rows.find((row) => row.id === accountId);
    if (!current) throw new AccountNotFoundError();
    if (
      current.status !== "active" ||
      current.discordUserId === getAuthorityConfig().ownerUserId
    )
      throw new AccountIneligibleError();
    await lockTargetSessions(tx, accountId);
    const [admin] = await tx
      .select({ id: adminGrants.id })
      .from(adminGrants)
      .where(
        and(
          eq(adminGrants.accountId, accountId),
          isNull(adminGrants.revokedAt),
        ),
      );
    if (kind === "uploader" && admin) throw new AccountIneligibleError();
    // Both provider outcomes revalidate issuer/target authority under the same
    // account locks. Existing-account checks use the membership version guard.
    if (!(await applyMembership(tx, current, check, actor)))
      throw new AccountIneligibleError();
    // Commit a confirmed denial for an eligible target before reporting failure.
    if (check.status !== "member") return null;
    const [uploader] = await tx
      .select({ id: uploaderGrants.id })
      .from(uploaderGrants)
      .where(
        and(
          eq(uploaderGrants.accountId, accountId),
          isNull(uploaderGrants.revokedAt),
        ),
      );
    if (admin || (kind === "uploader" && uploader))
      throw new GrantConflictError();
    if (uploader) {
      await tx
        .update(uploaderGrants)
        .set({ revokedAt: new Date(), revokedBy: actor.accountId })
        .where(eq(uploaderGrants.id, uploader.id));
      await invalidateTargetSessions(tx, accountId, actor);
      await appendAudit(tx, actor, {
        action: "uploader.revoked",
        targetType: "login_account",
        targetId: accountId,
        before: { uploader: true, uploaderGrantId: uploader.id },
        after: { uploader: false, reason: "promoted" },
      });
    }
    const table = kind === "admin" ? adminGrants : uploaderGrants;
    const [grant] = await tx
      .insert(table)
      .values({ accountId, issuedBy: actor.accountId })
      .returning({ id: table.id });
    await appendAudit(tx, actor, {
      action: kind + ".granted",
      targetType: "login_account",
      targetId: accountId,
      after:
        kind === "admin"
          ? { administrator: true, adminGrantId: grant.id }
          : { uploader: true, uploaderGrantId: grant.id },
    });
    return grant.id;
  });
  if (result === null) throw new AccountIneligibleError();
  return result;
}
async function revokeRole(
  accountId: string,
  kind: GrantKind,
): Promise<boolean> {
  const actor = await (kind === "admin" ? assertOwner() : assertAdmin());
  if (!isUuid(accountId)) throw new AccountNotFoundError();
  return db.transaction(async (tx) => {
    const rows = await lockAccounts(tx, [actor.accountId, accountId]);
    await lockActor(tx, actor);
    const target = rows.find((row) => row.id === accountId);
    if (!target) throw new AccountNotFoundError();
    if (target.discordUserId === getAuthorityConfig().ownerUserId)
      throw new AccountIneligibleError();
    await lockTargetSessions(tx, accountId);
    if (kind === "uploader") {
      const [admin] = await tx
        .select({ id: adminGrants.id })
        .from(adminGrants)
        .where(
          and(
            eq(adminGrants.accountId, accountId),
            isNull(adminGrants.revokedAt),
          ),
        );
      if (admin) throw new AccountIneligibleError();
    }
    const table = kind === "admin" ? adminGrants : uploaderGrants;
    const grants = await tx
      .update(table)
      .set({ revokedAt: new Date(), revokedBy: actor.accountId })
      .where(and(eq(table.accountId, accountId), isNull(table.revokedAt)))
      .returning({ id: table.id });
    if (!grants.length) return false;
    await invalidateTargetSessions(tx, accountId, actor);
    await appendAudit(tx, actor, {
      action: kind + ".revoked",
      targetType: "login_account",
      targetId: accountId,
      before:
        kind === "admin"
          ? { administrator: true, adminGrantId: grants[0].id }
          : { uploader: true, uploaderGrantId: grants[0].id },
      after: kind === "admin" ? { administrator: false } : { uploader: false },
    });
    return true;
  });
}
export async function grantAdministrator(accountId: string) {
  return grantRole(accountId, "admin");
}
export async function revokeAdministrator(accountId: string) {
  return revokeRole(accountId, "admin");
}
export async function grantUploader(accountId: string) {
  return grantRole(accountId, "uploader");
}
export async function revokeUploader(accountId: string) {
  return revokeRole(accountId, "uploader");
}
