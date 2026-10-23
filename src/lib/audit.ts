import "server-only";

import { and, eq, desc, inArray } from "drizzle-orm";
import { isUuid } from "@/lib/validation";

import { db } from "@/db";
import { auditLogs, games, pendingUploads } from "@/db/schema";
import type { Actor, AuditActorSnapshot } from "@/lib/auth";
import { lockActorAuthority, lockUploadAuthority } from "@/lib/authority";
import { bumpCacheRevisions, type CacheScope } from "@/lib/cache-revisions";
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
  uploader?: boolean;
  adminGrantId?: string;
  uploaderGrantId?: string;
  originalFilename?: string | null;
  fileHash?: string | null;
  comment?: string | null;
  deviceSessionId?: string;
  channel?: "browser" | "desktop";
  mode?: "transient" | "persistent";
  replacedSessionId?: string;
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
    "uploader",
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
  if (changes.originalFilename !== undefined)
    safe.originalFilename = auditFilename(changes.originalFilename);
  if (
    typeof changes.fileHash === "string" &&
    /^[a-f0-9]{64}$/.test(changes.fileHash)
  )
    safe.fileHash = changes.fileHash;
  for (const key of [
    "deviceSessionId",
    "replacedSessionId",
    "adminGrantId",
    "uploaderGrantId",
  ] as const) {
    if (isUuid(changes[key])) safe[key] = changes[key]!;
  }
  if (changes.channel === "browser" || changes.channel === "desktop")
    safe.channel = changes.channel;
  if (changes.mode === "transient" || changes.mode === "persistent")
    safe.mode = changes.mode;
  return safe;
}

export async function appendAudit(
  tx: DbTransaction,
  actor: AuditActorSnapshot | null,
  event: AuditEvent,
): Promise<boolean> {
  if (event.action === "replay.processed" && event.requestId) {
    await tx
      .select({ id: pendingUploads.id })
      .from(pendingUploads)
      .where(eq(pendingUploads.id, event.requestId))
      .for("update");
    const [existing] = await tx
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, event.action),
          eq(auditLogs.requestId, event.requestId),
        ),
      )
      .limit(1);
    if (existing) return false;
  }
  await tx.insert(auditLogs).values({
    actorRole: actor?.role ?? null,
    actorMemberId: actor?.memberId ?? null,
    actorCredentialId: actor?.credentialId ?? null,
    actorAccountId: actor?.accountId ?? null,
    actorDiscordUserId: actor?.discordUserId ?? null,
    actorAdminGrantId: actor?.adminGrantId ?? null,
    actorUploaderGrantId: actor?.uploaderGrantId ?? null,
    actorName: actor?.name ?? null,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId ?? null,
    result: event.result ?? "success",
    before: safeChanges(event.before),
    after: safeChanges(event.after),
    requestId: event.requestId ?? crypto.randomUUID(),
  });
  return true;
}

export async function recordAudit(
  actor: AuditActorSnapshot | null,
  event: AuditEvent,
): Promise<boolean> {
  return db.transaction((tx) => appendAudit(tx, actor, event));
}

/** Held through commit, so a completed revocation cannot race a mutation. */
export async function lockActor(
  tx: DbTransaction,
  actor: Actor,
): Promise<void> {
  await lockActorAuthority(tx, actor);
}

export async function withActorTransaction<T>(
  actor: Actor,
  work: (tx: DbTransaction, changes: Set<CacheScope>) => Promise<T>,
): Promise<T> {
  const changes = new Set<CacheScope>();
  const result = await db.transaction(async (tx) => {
    await lockActor(tx, actor);
    const result = await work(tx, changes);
    await bumpCacheRevisions(tx, changes);
    return result;
  });
  if (changes.size) await invalidateQueryCache();
  return result;
}

export async function listAuditLogs(limit = 50, offset = 0) {
  const { assertReadOwner } = await import("@/lib/session");
  await assertReadOwner();
  const rows = await db
    .select()
    .from(auditLogs)
    .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
    .limit(Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 50)
    .offset(Number.isSafeInteger(offset) ? Math.max(0, offset) : 0);
  const ids = rows.flatMap((row) => {
    const id = (row.after as AuditChanges | null)?.gameId;
    return isUuid(id) ? [id] : [];
  });
  const existing = ids.length
    ? await db
        .select({ id: games.id })
        .from(games)
        .where(inArray(games.id, ids))
    : [];
  const existingIds = new Set(existing.map((row) => row.id));
  return rows.map((row) => ({
    ...row,
    gameExists: existingIds.has(
      (row.after as AuditChanges | null)?.gameId ?? "",
    ),
  }));
}

/** File identity without retaining caller-local paths or control characters. */
export function auditFilename(value: string | null | undefined): string | null {
  if (!value) return null;
  return (
    value
      .split(/[\\/]/)
      .at(-1)!
      .replace(/[\x00-\x1f\x7f]/g, "")
      .slice(0, 256)
      .toWellFormed() || null
  );
}
export async function withUploadTransaction<T>(
  actor: Actor,
  work: (tx: DbTransaction) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    await lockUploadAuthority(tx, actor);
    return work(tx);
  });
}
