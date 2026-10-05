/**
 * Shared-key role auth using Web Crypto, shared by Proxy and server actions.
 * AUTH_SECRET is always server-only and independent of both login keys.
 * Each role's signing key is bound to its current login key for session revocation.
 */

export const SESSION_COOKIE = "llvy_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

const encoder = new TextEncoder();
const HKDF_SALT = "llvy-session-hkdf-v3";
const HKDF_INFO = "llvy-session-hmac";

export type SessionRole = "uploader" | "admin";
export type VerifiedSession = { role: SessionRole; issuedAt: number };

export class AuthConfigurationError extends Error {
  constructor() {
    super("Invalid authentication configuration. Check the required secrets.");
    this.name = "AuthConfigurationError";
  }
}

function getAuthConfig() {
  const uploader = process.env.UPLOAD_PASSWORD;
  const admin = process.env.ADMIN_PASSWORD;
  const secret = process.env.AUTH_SECRET?.trim();
  if (
    !uploader?.trim() ||
    !admin?.trim() ||
    uploader === admin ||
    !secret ||
    encoder.encode(secret).length < 32 ||
    secret === uploader ||
    secret === admin
  ) {
    throw new AuthConfigurationError();
  }
  return { secret, passwords: { uploader, admin } };
}

// At most two entries, so rotations do not retain an unbounded set of secrets.
const signingKeyCache = new Map<
  SessionRole,
  { secret: string; password: string; key: Promise<CryptoKey> }
>();

function getSigningKey(role: SessionRole): Promise<CryptoKey> {
  const { secret, passwords } = getAuthConfig();
  const password = passwords[role];
  const cached = signingKeyCache.get(role);
  if (cached?.secret === secret && cached.password === password) {
    return cached.key;
  }
  const key = deriveSigningKey(secret, password, role);
  signingKeyCache.set(role, { secret, password, key });
  return key;
}

async function deriveSigningKey(
  secret: string,
  password: string,
  role: SessionRole,
): Promise<CryptoKey> {
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
      salt: encoder.encode(JSON.stringify([HKDF_SALT, role, password])),
      info: encoder.encode(HKDF_INFO),
    },
    ikm,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

/** The server selects the role; caller-supplied roles never participate. */
export function authenticatePassword(input: string): SessionRole | null {
  const { passwords } = getAuthConfig();
  const uploader = timingSafeEqual(input, passwords.uploader);
  const admin = timingSafeEqual(input, passwords.admin);
  if (admin) return "admin";
  return uploader ? "uploader" : null;
}

/** Create a signed session token to store in the session cookie. */
export async function createSessionToken(role: SessionRole): Promise<string> {
  if (role !== "uploader" && role !== "admin") {
    throw new Error("Invalid session role");
  }
  const payload = `v3.${role}.${Date.now()}.${crypto.randomUUID()}`;
  const key = await getSigningKey(role);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );
  return `${payload}.${toBase64Url(signature)}`;
}

/** Read a role only after verifying its entire signed payload and current key. */
export async function readSessionToken(
  token: string | undefined | null,
): Promise<VerifiedSession | null> {
  if (!token || token.length > 256) return null;
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [version, role, timestamp, nonce, signaturePart] = parts;
  if (
    version !== "v3" ||
    (role !== "uploader" && role !== "admin") ||
    !/^\d{1,16}$/.test(timestamp) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      nonce,
    ) ||
    !/^[A-Za-z0-9_-]{43}$/.test(signaturePart)
  ) {
    return null;
  }

  const issuedAt = Number(timestamp);
  const now = Date.now();
  if (
    !Number.isSafeInteger(issuedAt) ||
    issuedAt > now + 60_000 ||
    now - issuedAt > SESSION_MAX_AGE_SECONDS * 1000
  ) {
    return null;
  }

  try {
    const signature = fromBase64Url(signaturePart);
    // Reject base64 aliases so one session has one identity for upload budgets.
    if (toBase64Url(signature.buffer) !== signaturePart) return null;
    const key = await getSigningKey(role);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      encoder.encode(parts.slice(0, 4).join(".")),
    );
    return valid ? { role, issuedAt } : null;
  } catch (error) {
    if (error instanceof AuthConfigurationError) return null;
    throw error;
  }
}

/** Boolean compatibility for upload handlers and existing authenticated reads. */
export async function verifySessionToken(
  token: string | undefined | null,
): Promise<boolean> {
  return (await readSessionToken(token)) !== null;
}

export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}
