"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  AuthConfigurationError,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  isAdminPath,
} from "@/lib/auth";
import { attemptLogin } from "@/lib/login";
import { sanitizeRedirect } from "@/lib/redirect";
import { trustedClientIp } from "@/lib/trusted-client-ip";

export type LoginState = { error: string } | null;

/** Vercel replaces this header at its edge. Never trust caller-supplied XFF. */
async function clientIp(): Promise<string | null> {
  return trustedClientIp(await headers(), {
    vercel: process.env.VERCEL,
    nodeEnv: process.env.NODE_ENV,
  });
}

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");
  const redirectTo = sanitizeRedirect(
    String(formData.get("redirectTo") ?? "/"),
  );

  let token: string;
  let destination = redirectTo;
  try {
    const attempt = await attemptLogin(password, await clientIp());
    if (!attempt.ok) return { error: attempt.error };
    token = await createSessionToken(attempt.role);
    if (
      attempt.role === "uploader" &&
      isAdminPath(new URL(redirectTo, "https://llvy.invalid").pathname)
    ) {
      destination = "/members";
    }
  } catch (error) {
    if (!(error instanceof AuthConfigurationError)) throw error;
    return {
      error: "로그인 설정에 문제가 있습니다. 운영자에게 문의하세요.",
    };
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  redirect(destination);
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  redirect("/login");
}
