"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/auth";
import { revokeSession } from "@/lib/auth-store";
import { getSession } from "@/lib/session";
export async function logout(): Promise<void> {
  try {
    const session = await getSession();
    if (session) await revokeSession(session);
  } catch {
    console.error("Server logout could not be recorded");
  }
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
