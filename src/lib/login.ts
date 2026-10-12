import "server-only";
import { checkLoginThrottle } from "@/lib/login-throttle";
import { budgetKey, consumeRequestBudgets } from "@/lib/request-budget";
import { recordAudit } from "@/lib/audit";
export const THROTTLED_MESSAGE =
  "시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.";
export async function allowAuthenticationRequest(clientIp: string | null) {
  if (!(await checkLoginThrottle(clientIp))) return false;
  return consumeRequestBudgets([
    { key: "login:global", limit: 100, windowMs: 60_000 },
  ]);
}
export async function recordLoginFailure(
  clientIp: string | null,
  reason: string,
) {
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
      after: { reason },
    });
  }
}
