import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { adminCredentials, auditLogs } from "@/db/schema";
import type { Actor } from "@/lib/auth";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth-errors";
import { invalidateQueryCache } from "@/lib/query-cache";

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type AuditChanges = {
  name?: string;
  birthYear?: number | null;
  memberId?: string | null;
  accountId?: string;
  playedAtOverride?: string | null;
  excludedAt?: string | null;
  gameId?: string;
  reason?: string;
  administrator?: boolean;
  comment?: string | null;
};
export type AuditEvent = {
  action: string;
  targetType: string;
  targetId?: string | null;
  result?: "success" | "failure" | "duplicate";
  before?: AuditChanges;
  after?: AuditChanges;
  requestId?: string;
};

// Explicit allowlist prevents accidentally serializing credentials or cookies.
function safeChanges(changes: AuditChanges | undefined) {
  if (!changes) return null;
  const safe: Record<string, string | number | boolean | null> = {};
  for (const key of [
    "name",
    "birthYear",
    "memberId",
    "accountId",
    "playedAtOverride",
    "excludedAt",
    "gameId",
    "reason",
    "administrator",
    "comment",
  ] as const) {
    const value = changes[key];
    if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number"
    )
      safe[key] = value;
    else if (typeof value === "string") safe[key] = value.slice(0, 256);
  }
  return safe;
}

export async function appendAudit(
  tx: DbTransaction,
  actor: Actor | null,
  event: AuditEvent,
): Promise<void> {
  await tx.insert(auditLogs).values({
    actorRole: actor?.role ?? null,
    actorMemberId: actor?.memberId ?? null,
    actorCredentialId: actor?.credentialId ?? null,
    actorName: actor?.name ?? null,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId ?? null,
    result: event.result ?? "success",
    before: safeChanges(event.before),
    after: safeChanges(event.after),
    requestId: event.requestId ?? crypto.randomUUID(),
  });
}

export async function recordAudit(
  actor: Actor | null,
  event: AuditEvent,
): Promise<void> {
  await db.transaction((tx) => appendAudit(tx, actor, event));
}

/** Held through commit, so a completed revocation cannot race a mutation. */
export async function lockActor(
  tx: DbTransaction,
  actor: Actor,
): Promise<void> {
  if (actor.role === "viewer") throw new ForbiddenError();
  if (actor.role === "owner") return;
  const [active] = await tx
    .select({ id: adminCredentials.id })
    .from(adminCredentials)
    .where(
      and(
        eq(adminCredentials.id, actor.credentialId ?? ""),
        eq(adminCredentials.memberId, actor.memberId ?? ""),
        isNull(adminCredentials.revokedAt),
      ),
    )
    .for("share");
  if (!active) throw new UnauthorizedError();
}

export async function withActorTransaction<T>(
  actor: Actor,
  work: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  const result = await db.transaction(async (tx) => {
    await lockActor(tx, actor);
    return work(tx);
  });
  if (result !== false) await invalidateQueryCache();
  return result;
}

export async function listAuditLogs(limit = 50, offset = 0) {
  const { assertOwner } = await import("@/lib/session");
  await assertOwner();
  return db
    .select()
    .from(auditLogs)
    .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
    .limit(Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 50)
    .offset(Number.isSafeInteger(offset) ? Math.max(0, offset) : 0);
}
