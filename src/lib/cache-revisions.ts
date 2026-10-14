import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { cacheRevisions } from "@/db/schema";
import type { DbTransaction } from "@/lib/audit";
import { measureCache } from "@/lib/cache-metrics";

export type CacheScope =
  | "members"
  | "accounts"
  | "game-list"
  | "history"
  | "riot-eligibility"
  | `game:${string}`;

/** Called last in a transaction, after all business/authority locks. */
export async function bumpCacheRevisions(
  tx: DbTransaction,
  scopes: Iterable<CacheScope>,
) {
  const ordered = [...new Set(scopes)].sort();
  if (!ordered.length) return;
  // Supports deploying the writer before the additive migration. Reads fail closed.
  const available = await tx.execute(
    sql`select to_regclass('public.cache_revisions') is not null as available`,
  );
  if (!available.rows[0]?.available) return;
  for (const scope of ordered)
    await tx
      .insert(cacheRevisions)
      .values({ scope, revision: BigInt(1) })
      .onConflictDoUpdate({
        target: cacheRevisions.scope,
        set: { revision: sql`${cacheRevisions.revision} + 1` },
      });
}

/** One statement observes policy and all dependencies in a single DB snapshot. */
export type RevisionSnapshot = {
  epoch: string;
  values: Record<string, string>;
};
export function revisionKey(
  snapshot: RevisionSnapshot,
  scopes: readonly CacheScope[],
) {
  const vector = [...new Set(scopes)]
    .sort()
    .map((scope) => [scope, snapshot.values[scope]]);
  if (vector.some(([, value]) => value === undefined))
    throw new Error("Missing cache dependency");
  return `${snapshot.epoch}:${createHash("sha256").update(JSON.stringify(vector)).digest("hex")}`;
}
export async function readCacheRevision(
  scopes: readonly CacheScope[],
): Promise<RevisionSnapshot | null> {
  const ordered = [...new Set(scopes)].sort();
  if (!ordered.length) return null;
  try {
    return await measureCache("revision_ms", async () => {
      const result = await db.execute(sql`
        select p.enabled, p.epoch,
          (select json_object_agg(r.scope, r.revision::text) from cache_revisions r
           where r.scope in (${sql.join(
             ordered.map((scope) => sql`${scope}`),
             sql`, `,
           )})) as revisions
        from cache_policy p where p.id = 'business'`);
      const row = result.rows[0];
      if (!row || row.enabled !== true || typeof row.epoch !== "string")
        return null;
      const revisions = row.revisions as Record<string, string> | null;
      const vector: [string, string][] = [];
      for (const scope of ordered) {
        // An absent game has no revision until its first committed change.
        const revision =
          revisions?.[scope] ?? (scope.startsWith("game:") ? "0" : null);
        if (typeof revision !== "string" || !/^\d+$/.test(revision))
          return null;
        vector.push([scope, revision]);
      }
      return { epoch: row.epoch, values: Object.fromEntries(vector) };
    });
  } catch {
    return null;
  }
}
