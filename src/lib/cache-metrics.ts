import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

type Measurement = { name: string; duration: number };
const scope = new AsyncLocalStorage<Measurement[]>();
export const withCacheMetrics = <T>(work: () => T) => scope.run([], work);

/** Call sites supply fixed labels, never search terms, keys, URLs or identities. */
export function cacheMetric(
  name: string,
  duration = 0,
  outcome?: string,
  bytes?: number,
) {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  const durationMs = Math.round(Math.max(0, duration) * 100) / 100;
  const entries = scope.getStore();
  if (entries && entries.length < 64)
    entries.push({ name: safe, duration: durationMs });
  if (process.env.CACHE_METRICS === "1")
    console.info(
      JSON.stringify({
        event: "cache",
        name: safe,
        durationMs,
        outcome,
        bytes,
      }),
    );
}
export async function measureCache<T>(
  name: string,
  work: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await work();
  } finally {
    cacheMetric(name, performance.now() - start);
  }
}
export function cacheServerTiming() {
  const sums = new Map<string, number>();
  for (const entry of scope.getStore() ?? [])
    sums.set(entry.name, (sums.get(entry.name) ?? 0) + entry.duration);
  return [...sums]
    .map(([name, value]) => `${name};dur=${value.toFixed(2)}`)
    .join(", ");
}
