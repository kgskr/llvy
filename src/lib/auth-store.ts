import "server-only";
import { revokeDevicesInTx } from "@/lib/desktop/revoke";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  adminGrants,
  uploaderGrants,
  authAccounts,
  authMembershipDecisions,
  authSessions,
  pendingUploads,
} from "@/db/schema";
import { appendAudit, type DbTransaction } from "@/lib/audit";
import { accountRole } from "@/lib/authority";
import {
  createSessionToken,
  getAuthorityConfig,
  randomReference,
  SESSION_MAX_AGE_SECONDS,
  type AuditActorSnapshot,
} from "@/lib/auth";
import { UnauthorizedError } from "@/lib/auth-errors";

export type DiscordIdentity = {
  id: string;
  username: string;
  displayName: string;
};
export type MembershipCheck = {
  userId: string;
  guildId: string;
  version: number;
  status: "member" | "absent" | "pending";
  checkedAt: Date;
};
export const maintenanceActor: AuditActorSnapshot = {
  role: "system",
  name: "인증 유지보수",
};
export function hashReference(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** Registration/save lock this evidence BEFORE accounts. Existing-account-only
 * callers keep their account-version guard and never acquire this lock. */
async function retainMembershipDecision(
  tx: DbTransaction,
  check: MembershipCheck,
) {
  if (check.guildId !== getAuthorityConfig().guildId) return false;
  const rows = await tx
    .insert(authMembershipDecisions)
    .values({
      guildId: check.guildId,
      discordUserId: check.userId,
      version: check.version,
    })
    .onConflictDoUpdate({
      target: [
        authMembershipDecisions.guildId,
        authMembershipDecisions.discordUserId,
      ],
      set: { version: check.version },
      setWhere: sql`${authMembershipDecisions.version} < ${check.version}`,
    })
    .returning({ version: authMembershipDecisions.version });
  return rows.length > 0;
}

/** Caller holds account/revoker UPDATE locks in ID order. No provider failure reaches here. */
export async function applyMembership(
  tx: DbTransaction,
  account: typeof authAccounts.$inferSelect,
  check: MembershipCheck,
  actor: AuditActorSnapshot = maintenanceActor,
  reactivate = false,
): Promise<boolean> {
  if (
    account.discordUserId !== check.userId ||
    check.guildId !== getAuthorityConfig().guildId ||
    account.membershipVersion >= check.version
  )
    return false;
  const denied = check.status !== "member";
  const now = new Date();
  await tx
    .update(authAccounts)
    .set({
      guildId: check.guildId,
      membershipStatus: check.status,
      membershipCheckedAt: check.checkedAt,
      membershipVersion: check.version,
      ...(denied
        ? {
            status: "suspended",
            suspendedAt: now,
            suspensionReason: check.status,
          }
        : reactivate
          ? { status: "active", suspendedAt: null, suspensionReason: null }
          : {}),
    })
    .where(eq(authAccounts.id, account.id));
  if (denied) {
    await tx
      .update(authSessions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(authSessions.accountId, account.id),
          isNull(authSessions.revokedAt),
        ),
      );
    await tx
      .update(adminGrants)
      .set({ revokedAt: now, revokedBy: actor.accountId ?? null })
      .where(
        and(
          eq(adminGrants.accountId, account.id),
          isNull(adminGrants.revokedAt),
        ),
      );
    const retiredUploaders = await tx
      .update(uploaderGrants)
      .set({ revokedAt: now, revokedBy: actor.accountId ?? null })
      .where(
        and(
          eq(uploaderGrants.accountId, account.id),
          isNull(uploaderGrants.revokedAt),
        ),
      )
      .returning({ id: uploaderGrants.id });
    for (const grant of retiredUploaders)
      await appendAudit(tx, actor, {
        action: "uploader.revoked",
        targetType: "login_account",
        targetId: account.id,
        before: { uploader: true, uploaderGrantId: grant.id },
        after: { uploader: false, reason: check.status },
      });
    // Owners have no grant ID to rotate. Retire their old reservations too,
    // so a fresh login after rejoining cannot restore upload authority.
    await revokeDevicesInTx(tx, account.id, actor);
    await tx
      .update(pendingUploads)
      .set({ state: "failed" })
      .where(
        and(
          eq(pendingUploads.actorAccountId, account.id),
          inArray(pendingUploads.state, ["pending", "processing"]),
        ),
      );
    if (account.status !== "suspended")
      await appendAudit(tx, actor, {
        action: "auth.account_suspended",
        targetType: "login_account",
        targetId: account.id,
        after: { reason: check.status, administrator: false },
      });
  }
  return true;
}
export async function saveMembership(
  check: MembershipCheck,
  actor: AuditActorSnapshot = maintenanceActor,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await retainMembershipDecision(tx, check))) return false;
    // revoked_by's FK also locks the actor account. Acquire both accounts in
    // the same order as grant/revoke, before taking any session or grant locks.
    const accounts = await tx
      .select()
      .from(authAccounts)
      .where(
        or(
          eq(authAccounts.discordUserId, check.userId),
          actor.accountId ? eq(authAccounts.id, actor.accountId) : undefined,
        ),
      )
      .orderBy(asc(authAccounts.id))
      .for("update");
    const account = accounts.find((row) => row.discordUserId === check.userId);
    return account ? applyMembership(tx, account, check, actor) : false;
  });
}
/** Identity and eligible bot evidence were verified in this callback only. */
export async function completeDiscordLogin(
  user: DiscordIdentity,
  check: MembershipCheck,
) {
  if (
    check.status !== "member" ||
    check.userId !== user.id ||
    check.guildId !== getAuthorityConfig().guildId
  )
    throw new UnauthorizedError();
  const issuedAt = Date.now();
  const reference = randomReference();
  const token = await createSessionToken(reference, issuedAt);
  const result = await db.transaction(async (tx) => {
    if (!(await retainMembershipDecision(tx, check)))
      throw new UnauthorizedError();
    await tx
      .insert(authAccounts)
      .values({
        discordUserId: user.id,
        username: user.username,
        displayName: user.displayName,
        guildId: check.guildId,
        membershipCheckedAt: check.checkedAt,
      })
      .onConflictDoNothing({ target: authAccounts.discordUserId });
    const [account] = await tx
      .select()
      .from(authAccounts)
      .where(eq(authAccounts.discordUserId, user.id))
      .for("update");
    if (!(await applyMembership(tx, account, check, maintenanceActor, true)))
      throw new UnauthorizedError();
    await tx
      .update(authAccounts)
      .set({
        username: user.username,
        displayName: user.displayName,
        lastLoginAt: new Date(issuedAt),
      })
      .where(eq(authAccounts.id, account.id));
    const [session] = await tx
      .insert(authSessions)
      .values({
        referenceHash: hashReference(reference),
        accountId: account.id,
        guildId: check.guildId,
        createdAt: new Date(issuedAt),
        expiresAt: new Date(issuedAt + SESSION_MAX_AGE_SECONDS * 1000),
      })
      .returning({ id: authSessions.id });
    const [grant] = await tx
      .select({ id: adminGrants.id })
      .from(adminGrants)
      .where(
        and(
          eq(adminGrants.accountId, account.id),
          isNull(adminGrants.revokedAt),
        ),
      );
    const [uploadGrant] = await tx
      .select({ id: uploaderGrants.id })
      .from(uploaderGrants)
      .where(
        and(
          eq(uploaderGrants.accountId, account.id),
          isNull(uploaderGrants.revokedAt),
        ),
      );
    const role = accountRole(
      user.id,
      grant?.id ?? null,
      uploadGrant?.id ?? null,
    );
    const actor = {
      role,
      name: user.displayName,
      accountId: account.id,
      discordUserId: user.id,
      sessionId: session.id,
      adminGrantId: role === "admin" ? (grant?.id ?? null) : null,
      uploaderGrantId: role === "uploader" ? (uploadGrant?.id ?? null) : null,
    };
    await appendAudit(tx, actor, {
      action: "auth.login",
      targetType: "session",
      targetId: session.id,
    });
    return actor;
  });
  return { ...result, token, issuedAt };
}
export async function revokeSession(
  actor: { accountId: string; sessionId: string } & AuditActorSnapshot,
) {
  await db.transaction(async (tx) => {
    await tx
      .select({ id: authAccounts.id })
      .from(authAccounts)
      .where(eq(authAccounts.id, actor.accountId))
      .for("update");
    const rows = await tx
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(authSessions.id, actor.sessionId),
          eq(authSessions.accountId, actor.accountId),
          isNull(authSessions.revokedAt),
        ),
      )
      .returning({ id: authSessions.id });
    if (rows.length)
      await appendAudit(tx, actor, {
        action: "auth.logout",
        targetType: "session",
        targetId: actor.sessionId,
      });
  });
}
