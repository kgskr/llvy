/** Cookie verification is optimistic; DB authority is checked in the DAL. */
export const SESSION_COOKIE = "llvy_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export type SessionRole = "viewer" | "uploader" | "admin" | "owner";
export type Actor = {
  role: SessionRole;
  accountId: string;
  discordUserId: string;
  sessionId: string;
  adminGrantId: string | null;
  uploaderGrantId?: string | null;
  name: string;
};
export type AuditActorSnapshot = {
  role: SessionRole | "system";
  name: string;
  accountId?: string | null;
  discordUserId?: string | null;
  adminGrantId?: string | null;
  uploaderGrantId?: string | null;
  memberId?: string | null;
  credentialId?: string | null;
};
export type VerifiedSession = { reference: string; issuedAt: number };
export class AuthConfigurationError extends Error {
  constructor() {
    super("Invalid authentication configuration. Check the required settings.");
    this.name = "AuthConfigurationError";
  }
}
const encoder = new TextEncoder();
export function isDiscordId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[1-9]\d{0,19}$/.test(value) &&
    BigInt(value) <= BigInt("18446744073709551615")
  );
}
export function getAuthorityConfig() {
  const secret = process.env.AUTH_SECRET?.trim();
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  const ownerUserId = process.env.DISCORD_OWNER_USER_ID?.trim();
  if (
    !secret ||
    encoder.encode(secret).length < 32 ||
    !isDiscordId(guildId) ||
    !isDiscordId(ownerUserId)
  )
    throw new AuthConfigurationError();
  return { secret, guildId, ownerUserId };
}
let signingKeyCache: { secret: string; key: Promise<CryptoKey> } | undefined;
function signingKey() {
  const { secret } = getAuthorityConfig();
  if (signingKeyCache?.secret === secret) return signingKeyCache.key;
  const key = (async () => {
    const ikm = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      "HKDF",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: encoder.encode("llvy-session-hkdf-v5"),
        info: encoder.encode("llvy-session-hmac"),
      },
      ikm,
      { name: "HMAC", hash: "SHA-256", length: 256 },
      false,
      ["sign", "verify"],
    );
  })();
  signingKeyCache = { secret, key };
  return key;
}
function encode(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (x) => String.fromCharCode(x)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
}
export function randomReference(): string {
  return encode(crypto.getRandomValues(new Uint8Array(32)));
}
export function isReference(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value))
    return false;
  try {
    return encode(decode(value)) === value;
  } catch {
    return false;
  }
}
export async function createSessionToken(
  reference: string,
  issuedAt = Date.now(),
): Promise<string> {
  if (!isReference(reference) || !Number.isSafeInteger(issuedAt))
    throw new Error("Invalid session reference");
  const payload = "v5." + issuedAt + "." + reference;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(),
    encoder.encode(payload),
  );
  return payload + "." + encode(new Uint8Array(signature));
}
export async function readSessionToken(
  token: string | null | undefined,
): Promise<VerifiedSession | null> {
  if (!token || token.length > 200) return null;
  const parts = token.split(".");
  const [version, timestamp, reference, signature] = parts;
  if (
    parts.length !== 4 ||
    version !== "v5" ||
    !/^\d{1,16}$/.test(timestamp) ||
    !isReference(reference) ||
    !isReference(signature)
  )
    return null;
  const issuedAt = Number(timestamp);
  if (
    !Number.isSafeInteger(issuedAt) ||
    issuedAt > Date.now() + 60_000 ||
    Date.now() - issuedAt >= SESSION_MAX_AGE_SECONDS * 1000
  )
    return null;
  try {
    return (await crypto.subtle.verify(
      "HMAC",
      await signingKey(),
      decode(signature),
      encoder.encode(parts.slice(0, 3).join(".")),
    ))
      ? { reference, issuedAt }
      : null;
  } catch (error) {
    if (error instanceof AuthConfigurationError) return null;
    throw error;
  }
}
export async function verifySessionToken(token: string | null | undefined) {
  return (await readSessionToken(token)) !== null;
}
export function isAdminPath(path: string) {
  return path === "/admin" || path.startsWith("/admin/");
}
export function isOwnerPath(path: string) {
  return path === "/admin/audit" || path.startsWith("/admin/audit/");
}
