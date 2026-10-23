import { canManage, canUpload } from "@/lib/capabilities";
import { NextResponse, type NextRequest } from "next/server";
import {
  AuthConfigurationError,
  isAdminPath,
  isOwnerPath,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth";
import { completeDiscordLogin, saveMembership } from "@/lib/auth-store";
import {
  DiscordAuthorizationError,
  identifyDiscordUser,
  lookupGuildMember,
} from "@/lib/discord";
import { allowAuthenticationRequest, recordLoginFailure } from "@/lib/login";
import {
  consumeLoginAttempt,
  LOGIN_ATTEMPT_COOKIE,
} from "@/lib/oauth-attempts";
import { trustedClientIp } from "@/lib/trusted-client-ip";
import {
  DiscordUnavailableError,
  ensureBotNotBlocked,
} from "@/lib/discord-circuit";
import { getBotConfig } from "@/lib/discord-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  let consumed = false;
  const ip = trustedClientIp(request.headers, {
    vercel: process.env.VERCEL,
    nodeEnv: process.env.NODE_ENV,
  });
  const fail = async (reason: string, retryAfter?: number) => {
    try {
      await recordLoginFailure(ip, reason);
    } catch {
      /* Failure logging must not expose provider data. */
    }
    const response = new NextResponse(null, {
      status: 303,
      headers: {
        location: "/login?error=" + reason,
        "cache-control": "no-store",
      },
    });
    if (retryAfter)
      response.headers.set("Retry-After", String(Math.ceil(retryAfter)));
    if (consumed) response.cookies.delete(LOGIN_ATTEMPT_COOKIE);
    return response;
  };
  try {
    if (!(await allowAuthenticationRequest(ip))) return fail("throttled");
    const params = request.nextUrl.searchParams;
    if (
      ["state", "code", "error", "error_description"].some(
        (key) => params.getAll(key).length > 1,
      ) ||
      params.getAll("state").length !== 1 ||
      params.has("code") === params.has("error")
    )
      return fail("invalid");
    const code = params.get("code");
    if (code !== null && (!code || code.length > 2048)) return fail("invalid");
    const attempt = await consumeLoginAttempt(
      params.get("state"),
      request.cookies.get(LOGIN_ATTEMPT_COOKIE)?.value,
    );
    if (!attempt) return fail("invalid");
    consumed = true;
    if (params.has("error"))
      return fail(
        params.get("error") === "access_denied" ? "cancelled" : "invalid",
      );
    const config = getBotConfig();
    await ensureBotNotBlocked(config.clientId, config.guildId);
    const user = await identifyDiscordUser(code!);
    const check = await lookupGuildMember(user.id);
    if (check.status !== "member") {
      await saveMembership(check);
      return fail("membership");
    }
    const session = await completeDiscordLogin(user, check);
    const path = new URL(attempt.redirectTo, "https://llvy.invalid").pathname;
    const destination =
      (!canManage(session.role) && isAdminPath(path)) ||
      (!canUpload(session.role) && path === "/upload") ||
      (session.role !== "owner" && isOwnerPath(path))
        ? "/"
        : attempt.redirectTo;
    const response = new NextResponse(null, {
      status: 303,
      headers: { location: destination, "cache-control": "no-store" },
    });
    response.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    response.cookies.delete(LOGIN_ATTEMPT_COOKIE);
    return response;
  } catch (error) {
    return fail(
      error instanceof AuthConfigurationError
        ? "configuration"
        : error instanceof DiscordAuthorizationError
          ? "invalid"
          : "unavailable",
      error instanceof DiscordUnavailableError
        ? error.retryAfterSeconds
        : undefined,
    );
  }
}
