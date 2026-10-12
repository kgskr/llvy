import "server-only";

import { randomUUID } from "node:crypto";
import type Redis from "ioredis";
import {
  getQueryCacheGeneration,
  QUERY_CACHE_TTL_SECONDS,
} from "@/lib/query-cache";
import { getValkeyConnection, valkeyFailed } from "@/lib/valkey";

import { AUTOCOMPLETE_LIMIT, compareSearchText } from "@/lib/search-contract";

type IndexOptions<T> = {
  namespace: string;
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
if redis.call('ZCARD', KEYS[1]) ~= tonumber(ARGV[1]) or redis.call('HLEN', KEYS[2]) ~= tonumber(ARGV[1]) then return 0 end
redis.call('RENAME', KEYS[1], KEYS[3])
redis.call('RENAME', KEYS[2], KEYS[4])
redis.call('EXPIRE', KEYS[3], ARGV[2])
redis.call('EXPIRE', KEYS[4], ARGV[2])
redis.call('SET', KEYS[5], ARGV[1], 'EX', ARGV[2])
return 1`;

  async function readIndex(client: Redis, key: string, input: string) {
    const bytes = Buffer.from(input);
    const stored = await client.eval(
      READ_INDEX,
      3,
      `${key}:names`,
      `${key}:accounts`,
      `${key}:ready`,
      Buffer.concat([Buffer.from("["), bytes]),
      // Valkey compares raw UTF-8 bytes; 0xff covers emoji as well as BMP text.
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

  async function publishIndex(client: Redis, key: string, accounts: T[]) {
    if (accounts.length === 0) {
      await client.set(`${key}:ready`, "0", "EX", QUERY_CACHE_TTL_SECONDS);
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
      5,
      `${temporary}:names`,
      `${temporary}:accounts`,
      `${key}:names`,
      `${key}:accounts`,
      `${key}:ready`,
      accounts.length,
      QUERY_CACHE_TTL_SECONDS,
    );
    if (published !== 1)
      throw new Error("Index build expired before publication");
  }

  const builds = new Map<string, Promise<T[]>>();

  /** Internal index helper: callers must authenticate before using this cache. */
  return async function queryAutocomplete(
    input: string,
    load: () => Promise<T[]>,
  ): Promise<T[]> {
    const loadSafe = async () =>
      (await load()).map((value) => {
        const safe = project(value);
        if (!safe) throw new Error("Invalid autocomplete source");
        return safe;
      });
    const connection = await getValkeyConnection();
    if (!connection) return matches(await loadSafe(), input);
    const { client, prefix } = connection;
    let key: string | null = null;
    try {
      const generation = await getQueryCacheGeneration(connection);
      if (generation) {
        key = `${prefix}:${generation}:${options.namespace}`;
        const stored = await readIndex(client, key, input);
        if (stored !== null) return stored;
      }
    } catch {
      valkeyFailed(client);
      return matches(await loadSafe(), input);
    }
    if (!key) return matches(await loadSafe(), input);

    const indexKey = key;

    let build = builds.get(indexKey);
    if (!build) {
      build = (async () => {
        // DB errors propagate once. Index failure still returns this DB snapshot.
        const accounts = await loadSafe();
        try {
          await publishIndex(client, indexKey, accounts);
        } catch {
          valkeyFailed(client);
        }
        return accounts;
      })();
      builds.set(indexKey, build);
    }
    try {
      return matches(await build, input);
    } finally {
      if (builds.get(indexKey) === build) builds.delete(indexKey);
    }
  };
}
