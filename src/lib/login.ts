import { verifyPassword } from "./auth";
import type { LoginThrottleLimits } from "./limits";
import { checkLoginThrottle } from "./login-throttle";

export type LoginAttempt = { ok: true } | { ok: false; error: string };

export const THROTTLED_MESSAGE =
  "시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.";
export const WRONG_PASSWORD_MESSAGE = "비밀번호가 올바르지 않습니다.";

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
    verify?: typeof verifyPassword;
    failedDelayMs?: number;
  } = {},
): Promise<LoginAttempt> {
  const throttle = overrides.throttle ?? checkLoginThrottle;
  if (!(await throttle(clientIp, overrides.limits))) {
    return { ok: false, error: THROTTLED_MESSAGE };
  }

  const verify = overrides.verify ?? verifyPassword;
  if (!password || !verify(password)) {
    const delayMs = overrides.failedDelayMs ?? FAILED_LOGIN_DELAY_MS;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return { ok: false, error: WRONG_PASSWORD_MESSAGE };
  }

  return { ok: true };
}
