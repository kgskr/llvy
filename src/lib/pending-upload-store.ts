import "server-only";

import { and, eq, gt, lt } from "drizzle-orm";

import { db } from "@/db";
import { pendingUploads, type PendingUpload } from "@/db/schema";
import { PENDING_UPLOAD_TTL_MS } from "@/lib/limits";
import { generateNonce, hashNonce, replayPathname } from "@/lib/pending-upload";

export type CreatedPendingUpload = {
  uploadId: string;
  /** Returned to the client exactly once; only its hash is stored. */
  nonce: string;
  pathname: string;
};

// Rows whose expiry passed more than a day ago are useless in any state;
// sweeping them on create keeps the table bounded without a cron.
const SWEEP_AGE_MS = 24 * 60 * 60 * 1000;

export async function createPendingUpload(): Promise<CreatedPendingUpload> {
  await db
    .delete(pendingUploads)
    .where(lt(pendingUploads.expiresAt, new Date(Date.now() - SWEEP_AGE_MS)));

  const uploadId = crypto.randomUUID();
  const nonce = generateNonce();
  const pathname = replayPathname(uploadId);
  await db.insert(pendingUploads).values({
    id: uploadId,
    nonceHash: hashNonce(nonce),
    pathname,
    expiresAt: new Date(Date.now() + PENDING_UPLOAD_TTL_MS),
  });
  return { uploadId, nonce, pathname };
}

export async function getPendingUpload(
  uploadId: string,
): Promise<PendingUpload | null> {
  const rows = await db
    .select()
    .from(pendingUploads)
    .where(eq(pendingUploads.id, uploadId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Atomically move a binding pending → processing, recording the exact Blob URL
 * being processed. Returns false when another request already claimed or
 * consumed it (or it expired), so a binding can never be processed twice.
 */
export async function claimPendingUpload(
  uploadId: string,
  blobUrl: string,
): Promise<boolean> {
  const rows = await db
    .update(pendingUploads)
    .set({ state: "processing", blobUrl })
    .where(
      and(
        eq(pendingUploads.id, uploadId),
        eq(pendingUploads.state, "pending"),
        gt(pendingUploads.expiresAt, new Date()),
      ),
    )
    .returning({ id: pendingUploads.id });
  return rows.length > 0;
}

/** Terminal state; the binding is consumed either way. */
export async function finishPendingUpload(
  uploadId: string,
  state: "processed" | "failed",
): Promise<void> {
  await db
    .update(pendingUploads)
    .set({ state })
    .where(eq(pendingUploads.id, uploadId));
}
