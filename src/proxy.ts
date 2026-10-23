import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, readSessionToken } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  // Desktop handlers authenticate independently using scoped bearer credentials.
  if (request.nextUrl.pathname.startsWith("/api/desktop/v1/"))
    return NextResponse.next();
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token);
  const { pathname, search } = request.nextUrl;

  if (session) {
    return NextResponse.next();
  }

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
  // Protect app routes while allowing login, maintenance, Next internals,
  // the favicon, and Vercel Web Analytics endpoints.
  // Exclusions are anchored to a path-segment boundary so e.g. /login-foo is
  // NOT accidentally excluded from auth.
  matcher: [
    "/((?!login$|login/|api/auth/discord$|api/auth/discord/callback$|api/maintenance/uploads$|api/maintenance/auth$|_next/static|_next/image|_vercel/insights$|_vercel/insights/|favicon\\.ico$).*)",
  ],
};
