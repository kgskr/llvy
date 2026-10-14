import "server-only";
import { getRedisConnection } from "@/lib/redis";
import type Redis from "ioredis";
import {
  readCacheRevision,
  revisionKey,
  type RevisionSnapshot,
  type CacheScope,
} from "@/lib/cache-revisions";
import { cacheMetric, measureCache } from "@/lib/cache-metrics";
import { requestCached } from "@/lib/cache-request";

/** Independent reads started in one turn share a single Redis round trip. */
export class CacheReads {
  private queue: {
    args: [string, number, ...(string | number | Buffer)[]];
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  }[] = [];
  constructor(private client: Redis) {}
  eval(
    ...args: [string, number, ...(string | number | Buffer)[]]
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.queue.push({ args, resolve, reject });
      if (this.queue.length === 1)
        queueMicrotask(() => {
          void this.flush();
        });
    });
  }
  private async flush() {
    const batch = this.queue;
    this.queue = [];
    try {
      const pipeline = this.client.pipeline();
      for (const entry of batch) pipeline.eval(...entry.args);
      cacheMetric("redis_read_roundtrip");
      const results = await pipeline.exec();
      if (!results || results.length !== batch.length)
        throw new Error("Incomplete cache pipeline");
      results.forEach(([error, value], i) =>
        error ? batch[i].reject(error) : batch[i].resolve(value),
      );
    } catch (error) {
      for (const entry of batch) entry.reject(error);
    }
  }
}

export class CacheBudget {
  private remaining = 150;
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.remaining <= 0) throw new Error("Cache budget exhausted");
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Cache budget exhausted")),
            this.remaining,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      this.remaining -= performance.now() - started;
    }
  }
}
export type CacheContext = {
  connection: NonNullable<Awaited<ReturnType<typeof getRedisConnection>>>;
  revision: string;
  snapshot: RevisionSnapshot;
  budget: CacheBudget;
  reads: CacheReads;
};

/** Authenticated callers batch their dependencies once, before any loader. */
const prepareRequestCache = requestCached(
  async (key): Promise<CacheContext | null> => {
    const scopes = JSON.parse(key) as CacheScope[];
    const budget = new CacheBudget();
    const connection = await measureCache("redis_connect_ms", () =>
      budget.run(getRedisConnection),
    ).catch(() => null);
    if (!connection) return null;
    const revision = await readCacheRevision(scopes);
    if (!revision) return null;
    return {
      connection,
      revision: revisionKey(revision, scopes),
      snapshot: revision,
      budget,
      reads: new CacheReads(connection.client),
    };
  },
);

export function prepareCache(scopes: readonly CacheScope[]) {
  return prepareRequestCache(JSON.stringify([...new Set(scopes)].sort()));
}

export function cacheDependencies(
  context: CacheContext | null,
  scopes: readonly CacheScope[],
): CacheContext | null {
  return context
    ? { ...context, revision: revisionKey(context.snapshot, scopes) }
    : null;
}
