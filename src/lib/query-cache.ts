import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { getValkeyConnection, valkeyFailed } from "@/lib/valkey";

export const QUERY_CACHE_TTL_SECONDS = 60;
const MAX_VALUE_BYTES = 256 * 1024;
const GENERATION_PATTERN = /^[0-9a-f-]{36}$/;

type CacheIdentity = {
  query: string;
  role: "viewer" | "admin" | "owner";
  args?: readonly unknown[];
};

/** Shared by query results and nickname indexes; callers handle cache errors. */
export async function getQueryCacheGeneration(
  connection: NonNullable<Awaited<ReturnType<typeof getValkeyConnection>>>,
): Promise<string | null> {
  const generationKey = `${connection.prefix}:generation`;
  let generation = await connection.client.get(generationKey);
  if (generation === null) {
    await connection.client.set(generationKey, randomUUID(), "NX");
    generation = await connection.client.get(generationKey);
  }
  return generation && GENERATION_PATTERN.test(generation) ? generation : null;
}

/** Call after authorization; the loader must return already-projected JSON data. */
export async function cachedQuery<T>(
  identity: CacheIdentity,
  load: () => Promise<T>,
): Promise<T> {
  const connection = await getValkeyConnection();
  if (!connection) return load();
  const { client, prefix } = connection;
  let key: string;
  try {
    const generation = await getQueryCacheGeneration(connection);
    if (!generation) return load();
    const digest = createHash("sha256")
      .update(JSON.stringify(identity.args ?? []))
      .digest("hex");
    key = `${prefix}:${generation}:${identity.role}:${identity.query}:${digest}`;
    const stored = await client.get(key);
    if (stored !== null && Buffer.byteLength(stored) <= MAX_VALUE_BYTES) {
      try {
        const entry = JSON.parse(stored);
        if (
          entry?.version === 1 &&
          typeof entry.expiresAt === "number" &&
          entry.expiresAt > Date.now() &&
          Object.hasOwn(entry, "value")
        )
          return entry.value as T;
      } catch {
        // Malformed or old entries are misses and get replaced below.
      }
    }
  } catch {
    valkeyFailed(client);
    return load();
  }

  // Database errors must propagate; never cache an exception or call load twice.
  const value = await load();
  try {
    const stored = JSON.stringify({
      version: 1,
      expiresAt: Date.now() + QUERY_CACHE_TTL_SECONDS * 1000,
      value,
    });
    if (Buffer.byteLength(stored) <= MAX_VALUE_BYTES)
      await client.set(key, stored, "EX", QUERY_CACHE_TTL_SECONDS);
  } catch {
    valkeyFailed(client);
  }
  return value;
}

/** Best effort after DB commit. Old fills remain in their captured generation. */
export async function invalidateQueryCache(): Promise<void> {
  const connection = await getValkeyConnection();
  if (!connection) return;
  try {
    await connection.client.set(
      `${connection.prefix}:generation`,
      randomUUID(),
    );
  } catch {
    valkeyFailed(connection.client);
  }
}
