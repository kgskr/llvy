"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
} from "@/lib/auth";
import { attemptLogin } from "@/lib/login";
import { sanitizeRedirect } from "@/lib/redirect";

export type LoginState = { error: string } | null;

/**
 * Best-effort hint for the per-client throttle bucket. Forwarded headers are
 * attacker-controlled, so this is NEVER the only throttle key — the always-on
 * global bucket inside attemptLogin() is the spoof-resistant floor.
 */
async function clientHint(): Promise<string | null> {
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim();
  return ip || null;
}

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");
  const redirectTo = sanitizeRedirect(
    String(formData.get("redirectTo") ?? "/"),
  );

  const attempt = await attemptLogin(password, await clientHint());
  if (!attempt.ok) {
    return { error: attempt.error };
  }

  const token = await createSessionToken();
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  redirect(redirectTo);
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  redirect("/login");
}
