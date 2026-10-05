import "server-only";

import { cookies } from "next/headers";

import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

/** Read and verify the session cookie. Use in route handlers / server actions. */
export async function hasValidSession(): Promise<boolean> {
  return (await getValidSessionToken()) !== null;
}

/** Return the verified cookie for per-session resource budgets. */
export async function getValidSessionToken(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return (await verifySessionToken(token)) ? token! : null;
}

/** Throw UnauthorizedError when there is no valid session. */
export async function assertSession(): Promise<void> {
  if (!(await hasValidSession())) {
    throw new UnauthorizedError();
  }
}
