import "server-only";

import { del, list } from "@vercel/blob";
import { and, eq, lt, ne, or } from "drizzle-orm";

import { db } from "@/db";
import { games, pendingUploads, requestBudgets } from "@/db/schema";
import { getBlobStoreConfig } from "@/lib/blob-store";

const EXPIRY_GRACE_MS = 24 * 60 * 60 * 1000;
const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BATCH = 50;

/** Reconcile only old, server-reserved paths. A committed game's Blob is kept. */
export async function reconcileExpiredUploads(): Promise<{
  examined: number;
  removed: number;
  failed: number;
}> {
  const store = getBlobStoreConfig();
  const now = Date.now();
  const cutoff = new Date(now - EXPIRY_GRACE_MS);
  const reclaimCutoff = new Date(now - CLAIM_TIMEOUT_MS);
  const claimable = or(
    ne(pendingUploads.state, "cleaning"),
    lt(pendingUploads.cleanupClaimedAt, reclaimCutoff),
  );
  const candidates = await db
    .select()
    .from(pendingUploads)
    .where(and(lt(pendingUploads.expiresAt, cutoff), claimable))
    .orderBy(pendingUploads.expiresAt)
    .limit(MAX_BATCH);

  let removed = 0;
  let failed = 0;
  for (const row of candidates) {
    const claimAt = new Date();
    const claimed = await db
      .update(pendingUploads)
      .set({ state: "cleaning", cleanupClaimedAt: claimAt })
      .where(
        and(
          eq(pendingUploads.id, row.id),
          lt(pendingUploads.expiresAt, cutoff),
          claimable,
        ),
      )
      .returning({ id: pendingUploads.id });
    if (claimed.length === 0) continue;

    try {
      // Processing may have committed even when the response or state update
      // failed. A game reference is authoritative; never delete that Blob.
      const canonicalUrl = `${store.origin}/${row.pathname}`;
      const committed = await db
        .select({ id: games.id })
        .from(games)
        .where(eq(games.blobUrl, canonicalUrl))
        .limit(1);
      if (committed.length === 0) {
        const objects = await list({
          prefix: row.pathname,
          limit: 2,
          token: store.token,
        });
        const exact = objects.blobs.find(
          (blob) => blob.pathname === row.pathname,
        );
        if (!exact && objects.hasMore) {
          throw new Error("Blob listing was incomplete for the bound path.");
        }
        if (exact) {
          if (exact.url !== canonicalUrl) {
            throw new Error(
              "Blob listing did not match the bound store and path.",
            );
          }
          await del(exact.url, { token: store.token });
        }
      }
      await db
        .delete(pendingUploads)
        .where(
          and(
            eq(pendingUploads.id, row.id),
            eq(pendingUploads.state, "cleaning"),
            eq(pendingUploads.cleanupClaimedAt, claimAt),
          ),
        );
      removed += 1;
    } catch (error) {
      failed += 1;
      console.error("Failed to reconcile expired upload:", row.id, error);
      // A later run can retry. Even if this update fails, a stale claim is
      // reclaimable after CLAIM_TIMEOUT_MS.
      try {
        await db
          .update(pendingUploads)
          .set({ state: "failed", cleanupClaimedAt: null })
          .where(
            and(
              eq(pendingUploads.id, row.id),
              eq(pendingUploads.state, "cleaning"),
              eq(pendingUploads.cleanupClaimedAt, claimAt),
            ),
          );
      } catch (resetError) {
        console.error("Failed to release cleanup claim:", row.id, resetError);
      }
    }
  }

  await db.delete(requestBudgets).where(lt(requestBudgets.resetAt, cutoff));
  return { examined: candidates.length, removed, failed };
}
