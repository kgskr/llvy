import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const authed = await verifySessionToken(token);

  if (authed) return NextResponse.next();

  const { pathname, search } = request.nextUrl;

  // API routes get a 401 rather than an HTML redirect so fetch() callers can
  // handle it (e.g. the Blob upload-token route and the process route).
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("redirectTo", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Protect everything except the login page, Next internals, and the favicon.
  // Exclusions are anchored to a path-segment boundary so e.g. /login-foo is
  // NOT accidentally excluded from auth.
  matcher: ["/((?!login$|login/|_next/static|_next/image|favicon\\.ico$).*)"],
};
