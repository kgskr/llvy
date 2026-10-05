/**
 * Shared-password session auth. Edge-compatible (Web Crypto only, no Node APIs,
 * no `server-only`) because it is used from the proxy as well as server actions.
 *
 * The session signing key is HKDF-derived from a dedicated AUTH_SECRET when set,
 * otherwise from UPLOAD_PASSWORD. Using AUTH_SECRET is recommended: it decouples
 * the signing key from the login password, so a leaked session token can't be
 * used to recover the password offline. Rotating either invalidates sessions.
 */

export const SESSION_COOKIE = "llvy_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

const encoder = new TextEncoder();
const PAYLOAD_PREFIX = "v2.";
const HKDF_SALT = "llvy-session-hkdf-v2";
const HKDF_INFO = "llvy-session-hmac";

function getPassword(): string {
  const secret = process.env.UPLOAD_PASSWORD;
  if (!secret) {
    throw new Error("Missing required environment variable: UPLOAD_PASSWORD");
  }
  return secret;
}

/** Dedicated signing secret if provided, else the login password. */
function getSigningSecret(): string {
  return process.env.AUTH_SECRET?.trim() || getPassword();
}

const signingKeyCache = new Map<string, Promise<CryptoKey>>();

function getSigningKey(): Promise<CryptoKey> {
  const secret = getSigningSecret();
  const password = getPassword();
  const cacheKey = JSON.stringify([secret, password]);
  let key = signingKeyCache.get(cacheKey);
  if (!key) {
    key = deriveSigningKey(secret, password);
    signingKeyCache.set(cacheKey, key);
  }
  return key;
}

async function deriveSigningKey(
  secret: string,
  password: string,
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
      // Bind sessions to the current shared password even with a dedicated
      // signing secret. Rotating either credential must revoke old sessions.
      salt: encoder.encode(`${HKDF_SALT}:${password}`),
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

/** Constant-time check of a submitted password against UPLOAD_PASSWORD. */
export function verifyPassword(input: string): boolean {
  return timingSafeEqual(input, getPassword());
}

/** Create a signed session token to store in the session cookie. */
export async function createSessionToken(): Promise<string> {
  const payload = `${PAYLOAD_PREFIX}${Date.now()}.${crypto.randomUUID()}`;
  const key = await getSigningKey();
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );
  return `${payload}.${toBase64Url(signature)}`;
}

/** Verify a session token's signature. Returns false for any malformed input. */
export async function verifySessionToken(
  token: string | undefined | null,
): Promise<boolean> {
  if (!token) return false;
  const lastDot = token.lastIndexOf(".");
  if (lastDot <= 0) return false;

  const payload = token.slice(0, lastDot);
  const signaturePart = token.slice(lastDot + 1);
  if (!payload.startsWith(PAYLOAD_PREFIX)) return false;

  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = fromBase64Url(signaturePart);
  } catch {
    return false;
  }

  const key = await getSigningKey();
  const validSignature = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    encoder.encode(payload),
  );
  if (!validSignature) return false;

  // Enforce expiry from the signed timestamp (payload = `v2.<ms>.<nonce>`), so a leaked
  // token is not valid forever. Reject non-finite, far-future, or aged tokens.
  const issuedAt = Number(payload.split(".")[1]);
  if (!Number.isFinite(issuedAt)) return false;
  const now = Date.now();
  if (issuedAt > now + 60_000) return false;
  if (now - issuedAt > SESSION_MAX_AGE_SECONDS * 1000) return false;

  return true;
}
