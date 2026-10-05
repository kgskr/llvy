import "server-only";

import { cookies } from "next/headers";

import { SESSION_COOKIE, readSessionToken } from "@/lib/auth";

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super("Administrator access required");
    this.name = "ForbiddenError";
  }
}

/** Verify each request against the current role key and signing secret. */
export async function getSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token);
  return session ? { ...session, token: token! } : null;
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
export async function assertAdmin(): Promise<void> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  if (session.role !== "admin") throw new ForbiddenError();
}

/** Throw UnauthorizedError when there is no valid session. */
export async function assertSession(): Promise<void> {
  if (!(await hasValidSession())) {
    throw new UnauthorizedError();
  }
}
