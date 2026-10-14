import "server-only";

import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { prepareCache, type CacheContext } from "@/lib/cache-context";
import type { CacheScope } from "@/lib/cache-revisions";
import { cachePublicationScheduler } from "@/lib/cache-lifecycle";
import { cacheMetric, measureCache } from "@/lib/cache-metrics";
import type Redis from "ioredis";
import {
  getQueryCacheGeneration,
  QUERY_CACHE_TTL_SECONDS,
  cacheTtl,
} from "@/lib/query-cache";
import { getRedisConnection, redisFailed } from "@/lib/redis";

import { AUTOCOMPLETE_LIMIT, compareSearchText } from "@/lib/search-contract";

type IndexOptions<T> = {
  namespace: string;
  scopes?: readonly CacheScope[];
  indexedName: (value: T) => string;
  project: (value: unknown) => T | null;
};

/** Internal only. Each authenticated DAL owns its loader and minimal projection. */
export function createAutocompleteIndex<T>(options: IndexOptions<T>) {
  const { indexedName, project } = options;
  function matches(values: T[], input: string) {
    return values
      .filter((value) => indexedName(value).startsWith(input))
      .sort((a, b) => compareSearchText(indexedName(a), indexedName(b)))
      .slice(0, AUTOCOMPLETE_LIMIT);
  }
  // The marker, sorted set and display hash are read together. Missing or corrupt
  // snapshots are misses, including partial eviction.
  const READ_INDEX = `
local count = redis.call('GET', KEYS[3])
if not count or not tonumber(count) then return nil end
if tonumber(count) == 0 then return {} end
if redis.call('ZCARD', KEYS[1]) ~= tonumber(count) or redis.call('HLEN', KEYS[2]) ~= tonumber(count) then return nil end
local names = redis.call('ZRANGE', KEYS[1], ARGV[1], ARGV[2], 'BYLEX', 'LIMIT', 0, ARGV[3])
local result = {}
for _, name in ipairs(names) do
  local value = redis.call('HGET', KEYS[2], name)
  if not value then return nil end
  table.insert(result, name)
  table.insert(result, value)
end
return result`;

  // Check both temporary keys before touching either live key. Every publication
  // is atomic, and a failed/evicted build cannot expose half an index.
  const PUBLISH_INDEX = `
if ARGV[3] ~= '' and redis.call('GET', KEYS[6]) ~= ARGV[3] then return 0 end
if redis.call('ZCARD', KEYS[1]) ~= tonumber(ARGV[1]) or redis.call('HLEN', KEYS[2]) ~= tonumber(ARGV[1]) then return 0 end
redis.call('RENAME', KEYS[1], KEYS[3])
redis.call('RENAME', KEYS[2], KEYS[4])
redis.call('PEXPIREAT', KEYS[3], ARGV[2])
redis.call('PEXPIREAT', KEYS[4], ARGV[2])
redis.call('SET', KEYS[5], ARGV[1], 'PXAT', ARGV[2])
return 1`;

  async function readIndex(
    client: Redis,
    key: string,
    input: string,
    context?: CacheContext,
  ) {
    const bytes = Buffer.from(input);
    const stored = await (context?.reads ?? client).eval(
      READ_INDEX,
      3,
      `${key}:names`,
      `${key}:accounts`,
      `${key}:ready`,
      Buffer.concat([Buffer.from("["), bytes]),
      // Redis compares raw UTF-8 bytes; 0xff covers emoji as well as BMP text.
      Buffer.concat([Buffer.from("["), bytes, Buffer.from([0xff])]),
      AUTOCOMPLETE_LIMIT,
    );
    if (!Array.isArray(stored) || stored.length % 2 !== 0) return null;
    const result: T[] = [];
    try {
      for (let i = 0; i < stored.length; i += 2) {
        const safe = project(JSON.parse(String(stored[i + 1])));
        if (!safe) return null;
        if (
          indexedName(safe) !== stored[i] ||
          !indexedName(safe).startsWith(input)
        )
          return null;
        result.push(safe);
      }
    } catch {
      return null;
    }
    return result;
  }

  async function publishIndex(
    client: Redis,
    key: string,
    accounts: T[],
    ttl: number,
    token = "",
  ) {
    const bytes = Buffer.byteLength(JSON.stringify(accounts));
    if (accounts.length > 10000 || bytes > 8 * 1024 * 1024) {
      cacheMetric("index", 0, "oversize", bytes);
      return;
    }
    const expiresAt = Date.now() + ttl * 1000;
    if (accounts.length === 0) {
      await client.eval(
        `
if ARGV[2] ~= '' and redis.call('GET', KEYS[4]) ~= ARGV[2] then return 0 end
redis.call('DEL', KEYS[1], KEYS[2])
redis.call('SET', KEYS[3], '0', 'PXAT', ARGV[1])
return 1`,
        4,
        `${key}:names`,
        `${key}:accounts`,
        `${key}:ready`,
        `${key}:lease`,
        expiresAt,
        token,
      );
      return;
    }
    const temporary = `${key}:building:${randomUUID()}`;
    for (let offset = 0; offset < accounts.length; offset += 500) {
      const batch = accounts.slice(offset, offset + 500);
      const transaction = client.multi();
      for (const account of batch) {
        const name = indexedName(account);
        transaction.zadd(`${temporary}:names`, 0, name);
        transaction.hset(
          `${temporary}:accounts`,
          name,
          JSON.stringify(account),
        );
      }
      transaction.expire(`${temporary}:names`, QUERY_CACHE_TTL_SECONDS);
      transaction.expire(`${temporary}:accounts`, QUERY_CACHE_TTL_SECONDS);
      const responses = await transaction.exec();
      if (!responses || responses.some(([error]) => error))
        throw new Error("Index build failed");
    }
    const published = await client.eval(
      PUBLISH_INDEX,
      6,
      `${temporary}:names`,
      `${temporary}:accounts`,
      `${key}:names`,
      `${key}:accounts`,
      `${key}:ready`,
      `${key}:lease`,
      accounts.length,
      expiresAt,
      token,
    );
    if (published !== 1) cacheMetric("index", 0, "publication_lost");
  }

  const builds = new Map<string, Promise<T[]>>();

  /** Internal index helper: callers must authenticate before using this cache. */
  return async function queryAutocomplete(
    input: string,
    load: () => Promise<T[]>,
    suppliedContext?: CacheContext | null,
  ): Promise<T[]> {
    const loadSafe = async () =>
      (await load()).map((value) => {
        const safe = project(value);
        if (!safe) throw new Error("Invalid autocomplete source");
        return safe;
      });
    const context =
      suppliedContext !== undefined
        ? suppliedContext
        : options.scopes
          ? await prepareCache(options.scopes)
          : undefined;
    if (context === null) return matches(await loadSafe(), input);
    const connection = context?.connection ?? (await getRedisConnection());
    if (!connection) return matches(await loadSafe(), input);
    const { client, prefix } = connection;
    const run = <R>(work: () => Promise<R>) =>
      context ? context.budget.run(work) : work();
    let key = "";
    try {
      const generation = context
        ? `r3:${context.revision}`
        : await getQueryCacheGeneration(connection);
      if (generation) {
        key = `${prefix}:${generation}:${options.namespace}`;
        const stored = await measureCache("cache_read_ms", () =>
          run(() => readIndex(client, key, input, context)),
        );
        if (stored !== null) {
          cacheMetric("index", 0, "hit");
          return stored;
        }
      }
    } catch {
      redisFailed(client);
      return matches(await loadSafe(), input);
    }
    if (!key) return matches(await loadSafe(), input);

    const existing = builds.get(key);
    if (existing) {
      cacheMetric("index", 0, "coalesced");
      return matches(structuredClone(await existing), input);
    }
    let token = "";
    let sharedBuild: Promise<T[]> | undefined;
    if (context) {
      token = randomUUID();
      try {
        const acquired = await run(() =>
          client.set(`${key}:lease`, token, "PX", 10000, "NX"),
        );
        if (!acquired) {
          token = "";
          sharedBuild = builds.get(key);
          if (!sharedBuild) {
            await run(() => delay(50));
            const stored = await run(() =>
              readIndex(client, key, input, context),
            );
            if (stored !== null) return stored;
          }
        }
      } catch {
        redisFailed(client);
        return matches(await loadSafe(), input);
      }
    }
    // Loader failures must propagate, never become a second DB fallback load.
    if (sharedBuild) return matches(structuredClone(await sharedBuild), input);
    const indexKey = key;
    let deferred = false;
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    const release = async () => {
      if (token)
        await client.eval(
          `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`,
          1,
          `${indexKey}:lease`,
          token,
        );
    };
    const local = builds.get(key);
    if (local) {
      await release().catch(() => redisFailed(client));
      return matches(structuredClone(await local), input);
    }
    if (builds.size >= 256) {
      await release().catch(() => redisFailed(client));
      return matches(await loadSafe(), input);
    }
    const build = (async () => {
      try {
        const accounts = await measureCache("index_build_ms", loadSafe);
        if (!context || token) {
          const publish = async () => {
            try {
              await measureCache("index_publish_ms", () =>
                publishIndex(
                  client,
                  indexKey,
                  accounts,
                  context
                    ? cacheTtl("index", accounts)
                    : QUERY_CACHE_TTL_SECONDS,
                  token,
                ),
              );
            } catch {
              redisFailed(client);
            } finally {
              clearTimeout(cleanupTimer);
              await release().catch(() => redisFailed(client));
              if (builds.get(indexKey) === build) builds.delete(indexKey);
            }
          };
          const schedule = cachePublicationScheduler();
          if (schedule) {
            try {
              schedule(publish);
              deferred = true;
              cleanupTimer = setTimeout(() => {
                if (builds.get(indexKey) === build) builds.delete(indexKey);
              }, 10000);
              cleanupTimer.unref();
            } catch {
              await publish();
            }
          } else await publish();
        }
        return accounts;
      } catch (error) {
        await release().catch(() => redisFailed(client));
        throw error;
      }
    })();
    builds.set(indexKey, build);
    try {
      return matches(structuredClone(await build), input);
    } finally {
      if (!deferred && builds.get(indexKey) === build) builds.delete(indexKey);
    }
  };
}
