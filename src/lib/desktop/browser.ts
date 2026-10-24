import "server-only";
import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import type { Actor } from "@/lib/auth";
import { DesktopError, secretHash } from "./protocol";

function sameOrigin(origin: string | null, host: string | null) {
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    const local =
      process.env.NODE_ENV !== "production" &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return (
      url.origin === origin &&
      url.host === host &&
      (url.protocol === "https:" || local)
    );
  } catch {
    return false;
  }
}
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
    !sameOrigin(h.get("origin"), h.get("host")) ||
    typeof value !== "string" ||
    !/^[0-9a-f]{64}$/.test(value) ||
    !timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  )
    throw new DesktopError("forbidden", 403);
}
