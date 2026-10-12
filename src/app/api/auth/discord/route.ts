import { NextResponse, type NextRequest } from "next/server";
import { AuthConfigurationError } from "@/lib/auth";
import { allowAuthenticationRequest } from "@/lib/login";
import {
  createLoginAttempt,
  LOGIN_ATTEMPT_COOKIE,
  LOGIN_ATTEMPT_SECONDS,
} from "@/lib/oauth-attempts";
import { trustedClientIp } from "@/lib/trusted-client-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const ip = trustedClientIp(request.headers, {
      vercel: process.env.VERCEL,
      nodeEnv: process.env.NODE_ENV,
    });
    if (!(await allowAuthenticationRequest(ip))) return loginError("throttled");
    const attempt = await createLoginAttempt(
      request.nextUrl.searchParams.get("redirectTo") ?? "/",
    );
    const response = NextResponse.redirect(attempt.url, 303);
    response.headers.set("cache-control", "no-store");
    response.cookies.set(LOGIN_ATTEMPT_COOKIE, attempt.binding, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: LOGIN_ATTEMPT_SECONDS,
    });
    return response;
  } catch (error) {
    return loginError(
      error instanceof AuthConfigurationError ? "configuration" : "unavailable",
    );
  }
}
function loginError(code: string) {
  return new NextResponse(null, {
    status: 303,
    headers: { location: "/login?error=" + code, "cache-control": "no-store" },
  });
}
