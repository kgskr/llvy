/**
 * Best-effort in-memory fixed-window rate limiter.
 *
 * NOTE: state lives per warm serverless instance, so this is NOT a hard limit
 * across a distributed deployment — it slows a single attacker hitting one
 * instance and is a deliberate MVP stopgap. For real protection, back this with
 * a shared store (Vercel KV / Upstash ratelimit) keyed the same way.
 *
 * No `server-only` marker: this module holds no secrets and is imported from
 * unit tests via the login throttle. It must still never be bundled client-side
 * (nothing client-side imports it).
 */

type Bucket = { count: number; resetAt: number };

/** Bound memory without discarding active counters and reopening their limits. */
export const MAX_RATE_LIMIT_BUCKETS = 1024;

/** Injectable bucket storage so tests can run against a fresh, isolated map. */
export type RateLimitStore = Map<string, Bucket>;

export function createRateLimitStore(): RateLimitStore {
  return new Map();
}

const defaultStore: RateLimitStore = createRateLimitStore();

export type RateLimitResult = { ok: boolean; retryAfterMs: number };

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  opts: { store?: RateLimitStore; now?: number } = {},
): RateLimitResult {
  const store = opts.store ?? defaultStore;
  const now = opts.now ?? Date.now();
  const bucket = store.get(key);

  if (!bucket || now >= bucket.resetAt) {
    let nextResetAt = Infinity;
    for (const [storedKey, storedBucket] of store) {
      if (now >= storedBucket.resetAt) {
        store.delete(storedKey);
      } else {
        nextResetAt = Math.min(nextResetAt, storedBucket.resetAt);
      }
    }
    // Reject a new identity at capacity. Evicting an active entry here would
    // allow rotating identities to reset a global or per-client counter.
    if (store.size >= MAX_RATE_LIMIT_BUCKETS) {
      return { ok: false, retryAfterMs: nextResetAt - now };
    }
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterMs: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfterMs: bucket.resetAt - now };
  }
  return { ok: true, retryAfterMs: 0 };
}
