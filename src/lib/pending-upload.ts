import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Pure pending-upload binding logic (no DB access) shared by the upload-token
 * and process routes, and unit-tested directly.
 *
 * A binding proves that a Blob URL belongs to the upload THIS app just
 * authorized: the client holds `{ uploadId, nonce }` from `/api/uploads`, the
 * server holds the nonce's hash and the exact Blob pathname derived from the
 * uploadId. `/api/process` must never fetch — and above all never delete — a
 * Blob that does not match an active binding, because same-store URLs (e.g. a
 * stored game's canonical replay) are not proof of ownership.
 */

export type PendingUploadState =
  "pending" | "processing" | "processed" | "failed";

/** The columns validation needs; satisfied by the Drizzle row type. */
export type PendingUploadRow = {
  id: string;
  nonceHash: string;
  pathname: string;
  state: string;
  expiresAt: Date;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** 256-bit client-held secret, returned once and stored only as a hash. */
export function generateNonce(): string {
  return randomBytes(32).toString("base64url");
}

export function hashNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

function nonceMatches(nonce: string, nonceHash: string): boolean {
  const presented = Buffer.from(hashNonce(nonce), "hex");
  let stored: Buffer;
  try {
    stored = Buffer.from(nonceHash, "hex");
  } catch {
    return false;
  }
  return (
    presented.length === stored.length && timingSafeEqual(presented, stored)
  );
}

/** Server-chosen Blob pathname; embedding the uploadId makes the bound object
 * fully deterministic (no random suffix), so process-time matching is exact. */
export function replayPathname(uploadId: string): string {
  return `replays/${uploadId}.rofl`;
}

/** Require the app's trusted store, in addition to the pending pathname. */
export function isAllowedBlobHost(value: string, storeOrigin: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.origin === storeOrigin &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function blobUrlMatchesPathname(blobUrl: string, pathname: string): boolean {
  try {
    return new URL(blobUrl).pathname === `/${pathname}`;
  } catch {
    return false;
  }
}

export type ClaimRejection =
  "not_found" | "consumed" | "expired" | "nonce_mismatch" | "url_mismatch";

export type ClaimValidation =
  { ok: true } | { ok: false; reason: ClaimRejection };

/**
 * Validate a `/api/process` claim against the stored binding. Runs BEFORE any
 * Blob fetch or delete; every rejection means the request must not touch the
 * supplied URL at all.
 */
export function validatePendingClaim(
  row: PendingUploadRow | null | undefined,
  claim: { nonce: string; blobUrl: string; now?: Date },
  storeOrigin: string,
): ClaimValidation {
  if (!row) return { ok: false, reason: "not_found" };
  // A consumed binding stays consumed: replays of processed/failed uploads are
  // rejected even with the correct nonce.
  if (row.state !== "pending") return { ok: false, reason: "consumed" };
  const now = claim.now ?? new Date();
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  if (!nonceMatches(claim.nonce, row.nonceHash)) {
    return { ok: false, reason: "nonce_mismatch" };
  }
  if (
    !isAllowedBlobHost(claim.blobUrl, storeOrigin) ||
    !blobUrlMatchesPathname(claim.blobUrl, row.pathname)
  ) {
    return { ok: false, reason: "url_mismatch" };
  }
  return { ok: true };
}

export type TokenValidation = { ok: true } | { ok: false; reason: string };

/**
 * Validate a Blob upload-token request (`/api/blob/upload`) against the
 * binding: the browser may only mint a token for the exact pathname the
 * binding reserved, while it is still pending and unexpired.
 */
export function validatePendingToken(
  row: PendingUploadRow | null | undefined,
  request: { nonce: string; pathname: string; now?: Date },
): TokenValidation {
  if (!row) return { ok: false, reason: "Unknown upload binding." };
  if (row.state !== "pending") {
    return { ok: false, reason: "Upload binding was already used." };
  }
  const now = request.now ?? new Date();
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "Upload binding has expired." };
  }
  if (!nonceMatches(request.nonce, row.nonceHash)) {
    return { ok: false, reason: "Upload binding is not valid." };
  }
  if (request.pathname !== row.pathname) {
    return { ok: false, reason: "Pathname does not match the upload binding." };
  }
  return { ok: true };
}
