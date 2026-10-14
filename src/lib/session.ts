import "server-only";

import { measureCache } from "@/lib/cache-metrics";
import { withCacheRequest } from "@/lib/cache-request";
import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import { cookies } from "next/headers";

import { SESSION_COOKIE, readSessionToken } from "@/lib/auth";
import { findSessionActor } from "@/lib/authority";
import { hashReference } from "@/lib/auth-store";
import { UnauthorizedError, ForbiddenError } from "@/lib/auth-errors";
export { UnauthorizedError, ForbiddenError } from "@/lib/auth-errors";

/** No membership TTL or provider calls: current DB account/session/grant only. */
export async function getSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token);
  if (!session) return null;
  const actor = await measureCache("auth_ms", () =>
    findSessionActor(hashReference(session.reference)),
  );
  return actor ? { ...actor, issuedAt: session.issuedAt, token: token! } : null;
}

const readScope = new AsyncLocalStorage<{
  session?: ReturnType<typeof getSession>;
}>();

/** Opt-in scope for one read handler; React cache alone does not cover routes. */
export function withReadSession<T>(read: () => T): T {
  return readScope.run({}, () => withCacheRequest(read));
}

/** One DB snapshot per render/read request, never shared across requests. */
export const getReadSession = cache(() => {
  const scope = readScope.getStore();
  if (!scope) return getSession();
  return (scope.session ??= getSession());
});

/** Read and verify the session cookie. Use in route handlers / server actions. */
export async function hasValidSession(): Promise<boolean> {
  return (await getValidSessionToken()) !== null;
}

/** Return the verified cookie for callers that need the current session token. */
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
  const session = await getReadSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

/** Owner-only reads share the render snapshot; mutations use assertOwner. */
export async function assertReadOwner() {
  const session = await assertSession();
  if (session.role !== "owner") throw new ForbiddenError();
  return session;
}
