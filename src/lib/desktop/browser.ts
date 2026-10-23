import "server-only";
import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import type { Actor } from "@/lib/auth";
import { getOAuthConfig } from "@/lib/discord-config";
import { DesktopError, secretHash } from "./protocol";
export function csrf(actor: Actor, action: string) {
  return secretHash("browser-csrf", actor.sessionId + "\0" + action);
}
export async function checkCsrf(
  actor: Actor,
  action: string,
  value: FormDataEntryValue | null,
) {
  const h = await headers();
  const expected = csrf(actor, action);
  if (
    h.get("origin") !== getOAuthConfig().origin ||
    typeof value !== "string" ||
    value.length !== expected.length ||
    !timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  )
    throw new DesktopError("forbidden", 403);
}
