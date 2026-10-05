import "server-only";

import { LOGIN_THROTTLE_LIMITS, type LoginThrottleLimits } from "./limits";
import { budgetKey, consumeRequestBudgets } from "./request-budget";

/** A shared, per-client limit. The caller must supply a platform-verified IP. */
export async function checkLoginThrottle(
  clientIp: string | null,
  limits: LoginThrottleLimits = LOGIN_THROTTLE_LIMITS,
): Promise<boolean> {
  if (!clientIp) return false;
  return consumeRequestBudgets([
    {
      key: budgetKey("login:ip", clientIp),
      limit: limits.perClientAttempts,
      windowMs: limits.windowMs,
    },
  ]);
}
