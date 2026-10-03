import { LOGIN_THROTTLE_LIMITS, type LoginThrottleLimits } from "./limits";
import { checkRateLimit, type RateLimitStore } from "./rate-limit";

export type LoginThrottleResult = { ok: boolean; retryAfterMs: number };

/**
 * Pre-auth login throttle with a spoof-resistant floor.
 *
 * The GLOBAL bucket is keyed by a constant and is always enforced, so an
 * attacker rotating `x-forwarded-for` (or any other request-controlled value)
 * cannot mint fresh buckets to escape throttling. The per-client bucket is an
 * additional best-effort partition that trips earlier for a single noisy
 * client; it is never the only control.
 */
export function checkLoginThrottle(
  clientHint: string | null,
  limits: LoginThrottleLimits = LOGIN_THROTTLE_LIMITS,
  store?: RateLimitStore,
): LoginThrottleResult {
  const opts = store ? { store } : {};

  // Count every attempt globally, including ones rejected for this client.
  const global = checkRateLimit(
    "login:global",
    limits.globalAttempts,
    limits.windowMs,
    opts,
  );
  // A globally rejected request must not allocate another client bucket.
  if (!global.ok) return global;

  const client = clientHint
    ? checkRateLimit(
        `login:client:${clientHint}`,
        limits.perClientAttempts,
        limits.windowMs,
        opts,
      )
    : { ok: true, retryAfterMs: 0 };

  return {
    ok: global.ok && client.ok,
    retryAfterMs: Math.max(global.retryAfterMs, client.retryAfterMs),
  };
}
