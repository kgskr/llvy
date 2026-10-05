"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  AuthConfigurationError,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  isAdminPath,
  isOwnerPath,
} from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { getSession } from "@/lib/session";
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
    token = await createSessionToken(attempt.actor);
    const pathname = new URL(redirectTo, "https://llvy.invalid").pathname;
    if (
      attempt.role === "viewer" &&
      (isAdminPath(pathname) || pathname === "/upload")
    ) {
      destination = "/";
    } else if (attempt.role !== "owner" && isOwnerPath(pathname)) {
      destination = "/games";
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
  // Local sign-out must remain possible even if live credential lookup fails.
  let session: Awaited<ReturnType<typeof getSession>> = null;
  try {
    session = await getSession();
  } catch {
    console.error("Logout credential lookup failed");
  }
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  if (session) {
    try {
      await recordAudit(session, {
        action: "auth.logout",
        targetType: "session",
      });
    } catch {
      console.error("Logout audit could not be recorded");
    }
  }
  redirect("/login");
}
