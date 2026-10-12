import "server-only";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  authAccounts,
  authReconciliationRuns,
  authSessions,
  oauthLoginAttempts,
} from "@/db/schema";
import { getAuthorityConfig } from "@/lib/auth";
import { applyMembership, maintenanceActor } from "@/lib/auth-store";
import { lookupGuildMember } from "@/lib/discord";
import { DiscordBusyError } from "@/lib/discord-circuit";
import { assertOwner } from "@/lib/session";

export async function cleanupExpiredAuthentication() {
  const now = new Date();
  const old = new Date(now.getTime() - 86_400_000);
  const sessions = await db
    .select({ id: authSessions.id })
    .from(authSessions)
    .where(
      or(
        lte(authSessions.expiresAt, now),
        and(isNotNull(authSessions.revokedAt), lt(authSessions.revokedAt, old)),
      ),
    )
    .orderBy(asc(authSessions.expiresAt))
    .limit(500);
  if (sessions.length)
    await db.delete(authSessions).where(
      inArray(
        authSessions.id,
        sessions.map((row) => row.id),
      ),
    );
  const attempts = await db
    .select({ hash: oauthLoginAttempts.stateHash })
    .from(oauthLoginAttempts)
    .where(lte(oauthLoginAttempts.expiresAt, now))
    .orderBy(asc(oauthLoginAttempts.expiresAt))
    .limit(500);
  if (attempts.length)
    await db.delete(oauthLoginAttempts).where(
      inArray(
        oauthLoginAttempts.stateHash,
        attempts.map((row) => row.hash),
      ),
    );
  return { sessions: sessions.length, attempts: attempts.length };
}
export async function reconcileGuildAccounts() {
  const { guildId } = getAuthorityConfig();
  const key = "guild:" + guildId;
  const owner = crypto.randomUUID();
  const started = Date.now();
  const run = await db.transaction(async (tx) => {
    await tx
      .insert(authReconciliationRuns)
      .values({ key })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(authReconciliationRuns)
      .where(eq(authReconciliationRuns.key, key))
      .for("update");
    if (row.leaseUntil && row.leaseUntil.getTime() > started) return null;
    const fresh = !row.cycleStartedAt;
    const [claimed] = await tx
      .update(authReconciliationRuns)
      .set({
        leaseOwner: owner,
        leaseUntil: new Date(started + 120_000),
        status: "running",
        ...(fresh
          ? {
              cycleStartedAt: new Date(started),
              cursor: null,
              examined: 0,
              suspended: 0,
              failed: 0,
            }
          : {}),
      })
      .where(eq(authReconciliationRuns.key, key))
      .returning();
    return claimed;
  });
  if (!run) return { status: "busy" as const };
  let cursor = run.cursor;
  let examined = 0;
  let complete = false;
  let failed = false;
  try {
    while (Date.now() - started < 45_000 && examined < 200) {
      const rows = await db
        .select({ id: authAccounts.id, userId: authAccounts.discordUserId })
        .from(authAccounts)
        .where(
          and(
            eq(authAccounts.guildId, guildId),
            eq(authAccounts.status, "active"),
            lte(authAccounts.registeredAt, run.cycleStartedAt!),
            cursor ? gt(authAccounts.id, cursor) : undefined,
          ),
        )
        .orderBy(asc(authAccounts.id))
        .limit(25);
      if (!rows.length) {
        complete = true;
        break;
      }
      for (const target of rows) {
        if (Date.now() - started >= 45_000 || examined >= 200) break;
        const check = await lookupGuildMember(target.userId, {
          deadline: started + 45_000,
        });
        const applied = await db.transaction(async (tx) => {
          const [lease] = await tx
            .select({ id: authReconciliationRuns.key })
            .from(authReconciliationRuns)
            .where(
              and(
                eq(authReconciliationRuns.key, key),
                eq(authReconciliationRuns.leaseOwner, owner),
                gt(authReconciliationRuns.leaseUntil, new Date()),
              ),
            )
            .for("update");
          if (!lease) return false;
          const [account] = await tx
            .select()
            .from(authAccounts)
            .where(eq(authAccounts.id, target.id))
            .for("update");
          const saved = account
            ? await applyMembership(tx, account, check, maintenanceActor)
            : false;
          await tx
            .update(authReconciliationRuns)
            .set({
              cursor: target.id,
              examined: sql`${authReconciliationRuns.examined} + 1`,
              suspended: sql`${authReconciliationRuns.suspended} + ${saved && check.status !== "member" ? 1 : 0}`,
            })
            .where(eq(authReconciliationRuns.key, key));
          return true;
        });
        if (!applied) throw new Error("Maintenance lease expired");
        cursor = target.id;
        examined += 1;
      }
    }
  } catch (error) {
    failed = !(error instanceof DiscordBusyError);
  }
  const [finished] = await db
    .update(authReconciliationRuns)
    .set({
      status: complete ? "completed" : "partial",
      leaseOwner: null,
      leaseUntil: null,
      ...(complete
        ? { lastCompletedAt: new Date(), cycleStartedAt: null, cursor: null }
        : {}),
      failed: sql`${authReconciliationRuns.failed} + ${failed ? 1 : 0}`,
    })
    .where(
      and(
        eq(authReconciliationRuns.key, key),
        eq(authReconciliationRuns.leaseOwner, owner),
      ),
    )
    .returning({
      status: authReconciliationRuns.status,
      examined: authReconciliationRuns.examined,
      suspended: authReconciliationRuns.suspended,
      failed: authReconciliationRuns.failed,
    });
  return finished ?? { status: "lease_lost" as const };
}
export async function getAuthenticationMaintenanceStatus() {
  await assertOwner();
  const [run] = await db
    .select({
      status: authReconciliationRuns.status,
      lastCompletedAt: authReconciliationRuns.lastCompletedAt,
      examined: authReconciliationRuns.examined,
      suspended: authReconciliationRuns.suspended,
      failed: authReconciliationRuns.failed,
    })
    .from(authReconciliationRuns)
    .where(
      eq(authReconciliationRuns.key, "guild:" + getAuthorityConfig().guildId),
    );
  return run ?? null;
}
