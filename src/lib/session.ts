import "server-only";

import { cookies } from "next/headers";

import { SESSION_COOKIE, readSessionToken } from "@/lib/auth";
import { findActiveAdmin } from "@/lib/admin-credentials";
import { UnauthorizedError, ForbiddenError } from "@/lib/auth-errors";
export { UnauthorizedError, ForbiddenError } from "@/lib/auth-errors";

/** Verify each request against the current role key and signing secret. */
export async function getSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token);
  if (!session) return null;
  const actor =
    session.role === "admin"
      ? await findActiveAdmin(session.credentialId!, session.memberId!)
      : {
          role: session.role,
          memberId: null,
          credentialId: null,
          name: session.role === "owner" ? "서비스 오너" : "일반 사용자",
        };
  return actor ? { ...session, ...actor, token: token! } : null;
}

/** Read and verify the session cookie. Use in route handlers / server actions. */
export async function hasValidSession(): Promise<boolean> {
  return (await getValidSessionToken()) !== null;
}

/** Return the verified cookie for per-session resource budgets. */
export async function getValidSessionToken(): Promise<string | null> {
  return (await getSession())?.token ?? null;
}

/** Protect mutations independently of the proxy and visible UI. */
export async function assertAdmin() {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  if (session.role === "viewer") throw new ForbiddenError();
  return session;
}

export async function assertOwner() {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  if (session.role !== "owner") throw new ForbiddenError();
  return session;
}

/** Throw UnauthorizedError when there is no valid session. */
export async function assertSession() {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}
