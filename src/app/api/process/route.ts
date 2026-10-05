import { del } from "@vercel/blob";
import { NextResponse } from "next/server";

import { getBlobStoreConfig } from "@/lib/blob-store";
import type { Actor } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { UnauthorizedError, ForbiddenError } from "@/lib/auth-errors";
import { ingestReplay } from "@/lib/ingest";
import { MAX_UPLOAD_BYTES } from "@/lib/limits";
import {
  isUuid,
  validatePendingClaim,
  type ClaimRejection,
} from "@/lib/pending-upload";
import {
  claimPendingUpload,
  finishPendingUpload,
  getPendingUpload,
} from "@/lib/pending-upload-store";
import { matchesUploadActor } from "@/lib/upload-actor";
import { RoflParseError } from "@/lib/rofl/parser";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
// Fetching + hashing a 10-30MB blob can take a few seconds.
export const maxDuration = 60;

type ProcessBody = {
  uploadId?: unknown;
  nonce?: unknown;
  blobUrl?: unknown;
  originalFilename?: unknown;
  lastModified?: unknown;
};

const CLAIM_REJECTIONS: Record<
  ClaimRejection,
  { error: string; status: number }
> = {
  not_found: { error: "Unknown upload binding.", status: 400 },
  consumed: { error: "This upload was already processed.", status: 409 },
  expired: {
    error: "The upload binding has expired. Upload again.",
    status: 410,
  },
  nonce_mismatch: { error: "Upload binding is not valid.", status: 400 },
  url_mismatch: {
    error: "Blob URL does not match the upload binding.",
    status: 400,
  },
};

/**
 * Best-effort cleanup of the CURRENT binding's blob; never lets a delete
 * failure mask the response. Only ever called with the bound URL — deleting
 * caller-supplied URLs with the app's Blob authority is exactly the scan
 * finding this route guards against.
 */
async function deleteBoundBlobQuietly(
  boundBlobUrl: string,
  token: string,
): Promise<void> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      del(boundBlobUrl, { token, abortSignal: controller.signal }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          // The Blob SDK stops retries for AbortError, but not TimeoutError.
          // The race also bounds time spent in a retry backoff already begun.
          controller.abort();
          reject(controller.signal.reason);
        }, 5_000);
      }),
    ]);
  } catch (error) {
    console.error("Failed to delete this upload's blob:", error);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The claim is already consumed even if this bookkeeping update fails. Retry
 * once, then leave it in processing and log the upload id for reconciliation.
 * A committed game must never lose its blob because this update failed.
 */
async function finishPendingUploadQuietly(
  uploadId: string,
  state: "processed" | "failed",
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await finishPendingUpload(uploadId, state);
      return;
    } catch (error) {
      if (attempt === 1) {
        console.error(
          "Failed to finalize upload state:",
          { uploadId, state },
          error,
        );
      }
    }
  }
}

async function failUpload(
  uploadId: string,
  actor: Actor,
  reason: string,
): Promise<void> {
  await finishPendingUploadQuietly(uploadId, "failed");
  try {
    await recordAudit(actor, {
      action: "replay.processed",
      targetType: "upload",
      targetId: uploadId,
      requestId: uploadId,
      result: "failure",
      after: { reason },
    });
  } catch {
    console.error("Upload failure audit could not be recorded", { uploadId });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  // Independent auth check (defense-in-depth beyond the proxy).
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role === "viewer")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: ProcessBody;
  try {
    const parsed: unknown = await request.json();
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400 },
      );
    }
    body = parsed as ProcessBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const uploadId = typeof body.uploadId === "string" ? body.uploadId : "";
  const nonce = typeof body.nonce === "string" ? body.nonce : "";
  const blobUrl = typeof body.blobUrl === "string" ? body.blobUrl : "";
  if (!isUuid(uploadId) || nonce === "" || blobUrl === "") {
    return NextResponse.json(
      { error: "Missing upload binding." },
      { status: 400 },
    );
  }

  // The binding is the authorization to touch this blob at all: validate
  // BEFORE any fetch or delete, then claim atomically so a binding can never
  // be processed twice (even by concurrent requests).
  const pending = await getPendingUpload(uploadId);
  let store: ReturnType<typeof getBlobStoreConfig>;
  try {
    store = getBlobStoreConfig();
  } catch {
    return NextResponse.json(
      { error: "Upload storage is unavailable." },
      { status: 503 },
    );
  }
  const validation = validatePendingClaim(
    pending,
    { nonce, blobUrl },
    store.origin,
  );
  if (!validation.ok) {
    const rejection = CLAIM_REJECTIONS[validation.reason];
    return NextResponse.json(
      { error: rejection.error },
      { status: rejection.status },
    );
  }
  if (!matchesUploadActor(pending, session))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // The claim establishes this exact object. Drop query/fragment aliases at
  // the boundary so every later read, delete and persisted URL is canonical.
  const boundBlobUrl = `${store.origin}/${pending!.pathname}`;
  if (!(await claimPendingUpload(uploadId, boundBlobUrl))) {
    const rejection = CLAIM_REJECTIONS.consumed;
    return NextResponse.json(
      { error: rejection.error },
      { status: rejection.status },
    );
  }
  // From here on the binding is consumed; blobUrl is proven to be exactly the
  // object this binding authorized, so it is safe to fetch and clean up.

  const originalFilename =
    typeof body.originalFilename === "string" ? body.originalFilename : null;
  const lastModified =
    typeof body.lastModified === "number" ? body.lastModified : null;

  let bytes: Uint8Array;
  try {
    // The same signal also bounds response.arrayBuffer(), leaving time for
    // failure bookkeeping before the platform's 60-second execution limit.
    const response = await fetch(boundBlobUrl, {
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
      cache: "no-store",
      // Authenticate private reads only after store/path/nonce validation.
      // Use fetch instead of the SDK get() to keep redirects forbidden.
      ...(store.access === "private"
        ? { headers: { authorization: `Bearer ${store.token}` } }
        : {}),
    });
    if (!response.ok) {
      // The binding is consumed either way, so clear any blob left behind.
      await deleteBoundBlobQuietly(boundBlobUrl, store.token);
      await failUpload(uploadId, session, "download_failed");
      return NextResponse.json(
        { error: "Could not download the uploaded file." },
        { status: 502 },
      );
    }
    const declaredLength = Number(
      response.headers.get("content-length") ?? "0",
    );
    if (declaredLength > MAX_UPLOAD_BYTES) {
      await deleteBoundBlobQuietly(boundBlobUrl, store.token);
      await failUpload(uploadId, session, "file_too_large");
      return NextResponse.json(
        { error: "File is too large." },
        { status: 413 },
      );
    }
    bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      await deleteBoundBlobQuietly(boundBlobUrl, store.token);
      await failUpload(uploadId, session, "file_too_large");
      return NextResponse.json(
        { error: "File is too large." },
        { status: 413 },
      );
    }
  } catch {
    await deleteBoundBlobQuietly(boundBlobUrl, store.token);
    await failUpload(uploadId, session, "download_failed");
    return NextResponse.json(
      { error: "Could not download the uploaded file." },
      { status: 502 },
    );
  }

  let result: Awaited<ReturnType<typeof ingestReplay>>;
  try {
    result = await ingestReplay({
      bytes,
      blobUrl: boundBlobUrl,
      originalFilename,
      lastModified,
      actor: session,
      uploadId,
    });
  } catch (error) {
    if (error instanceof RoflParseError) {
      // A rejected replay cannot have committed a game, so cleanup is safe.
      await deleteBoundBlobQuietly(boundBlobUrl, store.token);
      await failUpload(uploadId, session, "invalid_replay");
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      await deleteBoundBlobQuietly(boundBlobUrl, store.token);
      await failUpload(uploadId, session, "authority_revoked");
      return NextResponse.json(
        { error: "Administrator authority is no longer valid." },
        { status: 403 },
      );
    }
    // A dropped connection can hide a successful COMMIT. Preserve the file
    // for that game's canonical URL or later reconciliation; an exception
    // alone cannot prove that the transaction was rolled back.
    console.error(
      "Replay ingestion failed; preserving blob because commit outcome may be unknown:",
      { uploadId, blobUrl: boundBlobUrl },
      error,
    );
    await failUpload(uploadId, session, "commit_outcome_unknown");
    return NextResponse.json(
      { error: "Failed to process the replay." },
      { status: 500 },
    );
  }

  // Ingestion has committed. Only a duplicate's newly uploaded blob is an
  // orphan; a state-update failure must preserve a new game's canonical blob.
  if (result.duplicate) {
    await deleteBoundBlobQuietly(boundBlobUrl, store.token);
  }
  await finishPendingUploadQuietly(uploadId, "processed");
  return NextResponse.json(result);
}
