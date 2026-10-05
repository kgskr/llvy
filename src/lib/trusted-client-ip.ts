import { isIP } from "node:net";

/** Only Vercel's edge-normalized header may partition production login limits. */
export function trustedClientIp(
  headers: Headers,
  environment: { vercel: string | undefined; nodeEnv: string | undefined },
): string | null {
  if (environment.vercel === "1") {
    const ip = headers.get("x-vercel-forwarded-for")?.trim() ?? "";
    return isIP(ip) ? ip : null;
  }
  return environment.nodeEnv === "production" ? null : "local-development";
}
