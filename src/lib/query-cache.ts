import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { getRedisConnection, redisFailed } from "@/lib/redis";
import { CacheBudget, type CacheContext } from "@/lib/cache-context";
import { cacheMetric, measureCache } from "@/lib/cache-metrics";

export const QUERY_CACHE_TTL_SECONDS = 60;
const MAX_VALUE_BYTES = 256 * 1024;
const GENERATION_PATTERN = /^[0-9a-f-]{36}$/;
const pending = new Map<string, Promise<unknown>>();
export const CACHE_TTLS = {
  members: 86400,
  list: 1800,
  detail: 21600,
  aggregate: 3600,
  page: 1800,
  accounts: 1800,
  search: 300,
  index: 21600,
} as const;
export type CachePolicy = keyof typeof CACHE_TTLS;
export function cacheTtl(policy: CachePolicy, value: unknown) {
  if (value === null) return 30;
  const ttl = CACHE_TTLS[policy];
  return policy === "members"
    ? ttl
    : Math.round(ttl * (0.9 + Math.random() * 0.2));
}

type CacheIdentity = {
  query: string;
  role: "viewer" | "uploader" | "admin" | "owner";
  args?: readonly unknown[];
  policy?: CachePolicy;
  admit?: boolean;
};

/** Compatibility for legacy readers during deployment. */
export async function getQueryCacheGeneration(
  connection: NonNullable<Awaited<ReturnType<typeof getRedisConnection>>>,
) {
  const generationKey = `${connection.prefix}:generation`;
  let generation = await connection.client.get(generationKey);
  if (generation === null) {
    await connection.client.set(generationKey, randomUUID(), "NX");
    generation = await connection.client.get(generationKey);
  }
  return generation && GENERATION_PATTERN.test(generation) ? generation : null;
}

/** Authorization and projection belong to the DAL. null context explicitly bypasses. */
export async function cachedQuery<T>(
  identity: CacheIdentity,
  load: () => Promise<T>,
  context?: CacheContext | null,
): Promise<T> {
  const loader = () => measureCache("db_load_ms", load);
  if (context === null || identity.admit === false) {
    cacheMetric(identity.query, 0, "bypass");
    return loader();
  }
  const budget = context?.budget ?? new CacheBudget();
  const connection =
    context?.connection ??
    (await budget.run(getRedisConnection).catch(() => null));
  if (!connection) return loader();
  const { client, prefix } = connection;
  let key: string;
  try {
    const generation = context
      ? `r3:${context.revision}`
      : await budget.run(() => getQueryCacheGeneration(connection));
    if (!generation) return loader();
    const digest = createHash("sha256")
      .update(
        JSON.stringify(["member-birth-years-v2", ...(identity.args ?? [])]),
      )
      .digest("hex");
    key = `${prefix}:${generation}:${identity.role}:${identity.query}:${digest}`;
    const stored = await measureCache("cache_read_ms", () =>
      budget.run(() => client.get(key)),
    );
    if (stored !== null && Buffer.byteLength(stored) <= MAX_VALUE_BYTES) {
      try {
        const entry = JSON.parse(stored);
        if (
          entry?.version === 1 &&
          typeof entry.expiresAt === "number" &&
          entry.expiresAt > Date.now() &&
          Object.hasOwn(entry, "value")
        ) {
          cacheMetric(identity.query, 0, "hit", Buffer.byteLength(stored));
          return entry.value as T;
        }
      } catch {
        /* Corrupt entries are misses. */
      }
    }
  } catch {
    redisFailed(client);
    return loader();
  }
  const existing = pending.get(key);
  if (existing) {
    cacheMetric(identity.query, 0, "coalesced");
    return structuredClone(await existing) as T;
  }
  cacheMetric(identity.query, 0, "miss");
  const fill = async () => {
    const value = await loader();
    try {
      const ttl = context
        ? cacheTtl(identity.policy ?? "list", value)
        : QUERY_CACHE_TTL_SECONDS;
      const stored = JSON.stringify({
        version: 1,
        expiresAt: Date.now() + ttl * 1000,
        value,
      });
      const bytes = Buffer.byteLength(stored);
      if (bytes <= MAX_VALUE_BYTES) await client.set(key, stored, "EX", ttl);
      else cacheMetric(identity.query, 0, "oversize", bytes);
    } catch {
      redisFailed(client);
    }
    return value;
  };
  if (pending.size >= 256) return fill();
  const operation = fill();
  pending.set(key, operation);
  try {
    return structuredClone(await operation);
  } finally {
    if (pending.get(key) === operation) pending.delete(key);
  }
}

/** Retained until old readers retire; revision readers do not depend on it. */
export async function invalidateQueryCache(): Promise<void> {
  const connection = await getRedisConnection();
  if (!connection) return;
  try {
    await connection.client.set(
      `${connection.prefix}:generation`,
      randomUUID(),
    );
  } catch {
    redisFailed(connection.client);
  }
}
