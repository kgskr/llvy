import { del, list } from "@vercel/blob";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { games, pendingUploads } from "@/db/schema";
import {
  client,
  db,
  migrateTestDatabase,
  resetTestDatabase,
} from "@/test/database";

vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => ({ db: (await import("@/test/database")).db }));
vi.mock("@vercel/blob", () => ({ del: vi.fn(), list: vi.fn() }));

import { reconcileExpiredUploads } from "./expired-upload-cleanup";
import { createPendingUpload, getPendingUpload } from "./pending-upload-store";

const origin = "https://test.private.blob.vercel-storage.com";

beforeAll(migrateTestDatabase, 30_000);
beforeEach(async () => {
  vi.resetAllMocks();
  await resetTestDatabase();
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test_secret");
  vi.stubEnv("BLOB_ACCESS", "private");
  vi.mocked(list).mockResolvedValue({
    blobs: [],
    cursor: undefined,
    hasMore: false,
  });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await client.close();
});

async function agedBinding(session: string) {
  const binding = await createPendingUpload(session);
  await db
    .update(pendingUploads)
    .set({ expiresAt: new Date(Date.now() - 2 * 86_400_000) })
    .where(eq(pendingUploads.id, binding.uploadId));
  return binding;
}

describe("expired upload reconciliation", () => {
  it("deletes an abandoned exact-path Blob and its binding", async () => {
    const binding = await agedBinding("abandoned");
    const url = `${origin}/${binding.pathname}`;
    vi.mocked(list).mockResolvedValue({
      blobs: [
        {
          url,
          downloadUrl: url,
          pathname: binding.pathname,
          size: 5,
          uploadedAt: new Date(),
          etag: "etag-abandoned",
        },
      ],
      cursor: undefined,
      hasMore: false,
    });

    expect(await reconcileExpiredUploads()).toEqual({
      examined: 1,
      removed: 1,
      failed: 0,
    });
    expect(del).toHaveBeenCalledExactlyOnceWith(url, {
      token: "vercel_blob_rw_test_secret",
    });
    expect(await getPendingUpload(binding.uploadId)).toBeNull();
  });

  it("keeps a committed game's Blob even when processing state was lost", async () => {
    const binding = await agedBinding("committed");
    const url = `${origin}/${binding.pathname}`;
    await db
      .update(pendingUploads)
      .set({ state: "processing", blobUrl: url })
      .where(eq(pendingUploads.id, binding.uploadId));
    await db.insert(games).values({
      fileHash: "committed-hash",
      blobUrl: url,
      playedAt: new Date(),
      playedAtSource: "upload",
    });

    expect(await reconcileExpiredUploads()).toMatchObject({ removed: 1 });
    expect(list).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(await getPendingUpload(binding.uploadId)).toBeNull();
  });

  it("retains a retryable binding when Blob deletion fails", async () => {
    const binding = await agedBinding("retry");
    const url = `${origin}/${binding.pathname}`;
    vi.mocked(list).mockResolvedValue({
      blobs: [
        {
          url,
          downloadUrl: url,
          pathname: binding.pathname,
          size: 5,
          uploadedAt: new Date(),
          etag: "etag-retry",
        },
      ],
      cursor: undefined,
      hasMore: false,
    });
    vi.mocked(del).mockRejectedValueOnce(new Error("temporary outage"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await reconcileExpiredUploads()).toMatchObject({
      failed: 1,
      removed: 0,
    });
    expect(await getPendingUpload(binding.uploadId)).toMatchObject({
      state: "failed",
    });
    expect(await reconcileExpiredUploads()).toMatchObject({
      failed: 0,
      removed: 1,
    });
    log.mockRestore();
  });

  it("does not touch fresh bindings", async () => {
    const binding = await createPendingUpload("fresh");
    expect(await reconcileExpiredUploads()).toMatchObject({ examined: 0 });
    expect(await getPendingUpload(binding.uploadId)).not.toBeNull();
    expect(list).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("refuses a foreign URL returned by the Blob listing", async () => {
    const binding = await agedBinding("foreign");
    vi.mocked(list).mockResolvedValue({
      blobs: [
        {
          url: `https://foreign.private.blob.vercel-storage.com/${binding.pathname}`,
          downloadUrl: "https://foreign.private.blob.vercel-storage.com/file",
          pathname: binding.pathname,
          size: 5,
          uploadedAt: new Date(),
          etag: "etag-foreign",
        },
      ],
      cursor: undefined,
      hasMore: false,
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await reconcileExpiredUploads()).toMatchObject({
      failed: 1,
      removed: 0,
    });
    expect(del).not.toHaveBeenCalled();
    expect(await getPendingUpload(binding.uploadId)).not.toBeNull();
    log.mockRestore();
  });
});
