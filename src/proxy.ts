import { NextResponse, type NextRequest } from "next/server";

import {
  SESSION_COOKIE,
  isAdminPath,
  isOwnerPath,
  readSessionToken,
} from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token);
  const { pathname, search } = request.nextUrl;

  if (session) {
    if (
      (session.role === "viewer" &&
        (isAdminPath(pathname) || pathname === "/upload")) ||
      (session.role !== "owner" && isOwnerPath(pathname))
    ) {
      return NextResponse.redirect(new URL("/members", request.url));
    }
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
  // Protect everything except the login page, Next internals, and the favicon.
  // Exclusions are anchored to a path-segment boundary so e.g. /login-foo is
  // NOT accidentally excluded from auth.
  matcher: [
    "/((?!login$|login/|api/maintenance/uploads$|_next/static|_next/image|favicon\\.ico$).*)",
  ],
};
