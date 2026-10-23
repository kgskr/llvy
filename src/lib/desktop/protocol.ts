import { createHash, createHmac, randomBytes } from "node:crypto";
import { getAuthorityConfig, isReference } from "@/lib/auth";
import { MAX_UPLOAD_BYTES } from "@/lib/limits";
import { isStorageText } from "@/lib/storage-text";

export const CLIENT_ID = "llvy-windows-uploader";
export const PROTOCOL = "desktop-v1";
export const SCOPES = "replay:upload replay:status";
export const ACCESS_MS = 15 * 60_000;
export const TRANSIENT_MS = 12 * 60 * 60_000;
export const PERSISTENT_MS = 30 * 86_400_000;
export class DesktopError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public retryAfter?: number,
  ) {
    super(code);
  }
}
export function requireDesktop() {
  if (process.env.DESKTOP_UPLOADER_ENABLED !== "true")
    throw new DesktopError("desktop_disabled", 503);
}
export function secretHash(domain: string, value: string) {
  return createHmac("sha256", getAuthorityConfig().secret)
    .update("llvy-desktop-v1\0" + domain + "\0" + value)
    .digest("hex");
}
export function token(kind: "access" | "refresh" | "code") {
  return kind + "." + randomBytes(32).toString("base64url");
}
export function validToken(value: unknown, kind: string): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(kind + ".") &&
    isReference(value.slice(kind.length + 1))
  );
}
export function pkce(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}
export function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new DesktopError("invalid_request");
  return input as Record<string, unknown>;
}
export function exactKeys(input: Record<string, unknown>, keys: string[]) {
  if (Object.keys(input).some((key) => !keys.includes(key)))
    throw new DesktopError("invalid_request");
}
export function validateStart(value: unknown) {
  const body = object(value);
  exactKeys(body, [
    "clientId",
    "redirectUri",
    "state",
    "codeChallenge",
    "codeChallengeMethod",
    "mode",
  ]);
  if (
    body.clientId !== CLIENT_ID ||
    body.codeChallengeMethod !== "S256" ||
    !isReference(body.state) ||
    !isReference(body.codeChallenge) ||
    !["transient", "persistent"].includes(String(body.mode))
  )
    throw new DesktopError("invalid_request");
  const uri = typeof body.redirectUri === "string" ? body.redirectUri : "";
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/callback$/.exec(uri);
  if (!match || Number(match[1]) > 65535)
    throw new DesktopError("invalid_redirect_uri");
  return {
    clientId: CLIENT_ID,
    redirectUri: uri,
    state: body.state,
    challenge: body.codeChallenge,
    mode: body.mode as "transient" | "persistent",
  };
}
export type UploadInput = {
  filename: string;
  size: number;
  lastModified: number;
  clientSha256: string;
};
export function validateUpload(value: unknown): UploadInput {
  const b = object(value);
  exactKeys(b, ["filename", "size", "lastModified", "clientSha256"]);
  if (
    typeof b.filename !== "string" ||
    b.filename.length > 255 ||
    !b.filename.toLowerCase().endsWith(".rofl") ||
    /[\\/\x00-\x1f]/.test(b.filename) ||
    !isStorageText(b.filename) ||
    !Number.isSafeInteger(b.size) ||
    Number(b.size) < 1 ||
    Number(b.size) > MAX_UPLOAD_BYTES ||
    !Number.isSafeInteger(b.lastModified) ||
    Number(b.lastModified) < 0 ||
    Number(b.lastModified) > 8_640_000_000_000_000 ||
    typeof b.clientSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(b.clientSha256)
  )
    throw new DesktopError("invalid_upload");
  return b as UploadInput;
}
export function fingerprint(input: UploadInput) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.filename,
        input.size,
        input.lastModified,
        input.clientSha256,
      ]),
    )
    .digest("hex");
}
export function reservationNonce(deviceId: string, uploadId: string) {
  return createHmac("sha256", getAuthorityConfig().secret)
    .update("llvy-desktop-nonce-v1\0" + deviceId + "\0" + uploadId)
    .digest("base64url");
}
