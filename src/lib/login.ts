import type { Actor, SessionRole } from "./auth";
import { authenticateAccessKey } from "./admin-credentials";
import { recordAudit } from "./audit";
import type { LoginThrottleLimits } from "./limits";
import { checkLoginThrottle } from "./login-throttle";
import { budgetKey, consumeRequestBudgets } from "./request-budget";

export type LoginAttempt =
  { ok: true; role: SessionRole; actor: Actor } | { ok: false; error: string };

export const THROTTLED_MESSAGE =
  "시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.";
export const WRONG_PASSWORD_MESSAGE = "접근 키가 올바르지 않습니다.";

const FAILED_LOGIN_DELAY_MS = 400;

/**
 * Core login decision, extracted from the server action for testability.
 *
 * Order matters: the shared throttle runs FIRST, so an over-limit request returns
 * without the submitted password ever reaching password verification. Failed
 * verifications get a fixed delay to slow online guessing.
 *
 * `overrides` exists for tests (isolated throttle, tiny limits, spy verifier,
 * zero delay); production callers pass none of it.
 */
export async function attemptLogin(
  password: string,
  clientIp: string | null,
  overrides: {
    limits?: LoginThrottleLimits;
    throttle?: typeof checkLoginThrottle;
    verify?: typeof authenticateAccessKey;
    failedDelayMs?: number;
  } = {},
): Promise<LoginAttempt> {
  const throttle = overrides.throttle ?? checkLoginThrottle;
  if (!(await throttle(clientIp, overrides.limits))) {
    // Record the incident once per trusted client/window instead of allowing
    // rejected guesses to amplify append-only audit storage without a bound.
    if (
      await consumeRequestBudgets([
        {
          key: budgetKey("login:audit", clientIp ?? "untrusted"),
          limit: 1,
          windowMs: 60_000,
        },
      ])
    ) {
      await recordAudit(null, {
        action: "auth.login",
        targetType: "session",
        result: "failure",
        after: { reason: "throttled" },
      });
    }
    return { ok: false, error: THROTTLED_MESSAGE };
  }

  const verify = overrides.verify ?? authenticateAccessKey;
  const actor =
    password && password.length <= 512 ? await verify(password) : null;
  if (!actor) {
    await recordAudit(null, {
      action: "auth.login",
      targetType: "session",
      result: "failure",
      after: { reason: "invalid_key" },
    });
    const delayMs = overrides.failedDelayMs ?? FAILED_LOGIN_DELAY_MS;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return { ok: false, error: WRONG_PASSWORD_MESSAGE };
  }

  await recordAudit(actor, { action: "auth.login", targetType: "session" });
  return { ok: true, role: actor.role, actor };
}
