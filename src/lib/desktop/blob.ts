import "server-only";
import {
  issueSignedToken,
  parseStoreIdFromDelegationToken,
  presignUrl,
} from "@vercel/blob";
import { getBlobStoreConfig } from "@/lib/blob-store";
import { DesktopError } from "./protocol";
import type { Job } from "./upload-store";

// Adapter pinned to @vercel/blob 2.5.0. Live public/private PUT acceptance is a release gate.
export async function transferDescriptor(job: Job) {
  const store = getBlobStoreConfig();
  if (store.origin !== job.storeOrigin)
    throw new DesktopError("storage_changed", 503);
  const validUntil = Math.min(
    Date.now() + 5 * 60_000,
    job.reservationExpiresAt.getTime(),
  );
  const constraints = {
    pathname: job.pathname,
    validUntil,
    allowedContentTypes: ["application/octet-stream"],
    maximumSizeInBytes: job.size!,
  };
  const material = await issueSignedToken({
    ...constraints,
    operations: ["put"],
    token: store.token,
    abortSignal: AbortSignal.timeout(10_000),
  });
  const { presignedUrl } = await presignUrl(material, {
    ...constraints,
    operation: "put",
    access: store.access,
    allowOverwrite: false,
    addRandomSuffix: false,
  });
  const url = new URL(presignedUrl);
  if (
    url.origin !== "https://vercel.com" ||
    url.pathname !== "/api/blob/" ||
    url.username ||
    url.password ||
    url.hash ||
    url.searchParams.get("pathname") !== job.pathname
  )
    throw new DesktopError("invalid_transfer_descriptor", 503);
  return {
    uploadUrl: presignedUrl,
    method: "PUT",
    headers: {
      "content-type": "application/octet-stream",
      "x-content-type": "application/octet-stream",
      "x-api-version": "12",
      "x-vercel-blob-access": store.access,
      "x-vercel-blob-store-id": parseStoreIdFromDelegationToken(
        material.delegationToken,
      ),
    },
    expiresAt: new Date(validUntil).toISOString(),
  };
}
export async function readBoundObject(job: Job, method: "GET" | "HEAD") {
  const store = getBlobStoreConfig();
  if (store.origin !== job.storeOrigin)
    throw new DesktopError("storage_changed", 503);
  // Neither endpoint nor path comes from an HTTP caller.
  return fetch(`${store.origin}/${job.pathname}`, {
    method,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
    ...(store.access === "private"
      ? { headers: { authorization: `Bearer ${store.token}` } }
      : {}),
  });
}
export async function limitedBytes(response: Response, max: number) {
  const reader = response.body?.getReader();
  if (!reader) throw new DesktopError("download_failed", 502);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new DesktopError("file_mismatch", 422);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
