import { randomUUID } from "node:crypto";

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

import { pendingUploads } from "@/db/schema";
import {
  client,
  db,
  migrateTestDatabase,
  resetTestDatabase,
} from "@/test/database";

vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => ({ db: (await import("@/test/database")).db }));

import { PENDING_UPLOAD_TTL_MS } from "./limits";
import { hashNonce, replayPathname } from "./pending-upload";
import {
  claimPendingUpload,
  createPendingUpload,
  finishPendingUpload,
  getPendingUpload,
} from "./pending-upload-store";

beforeAll(migrateTestDatabase, 30_000);
beforeEach(resetTestDatabase);
afterAll(() => client.close());

describe("pending upload persistence", () => {
  it("stores only a nonce hash and binds the generated pathname with an expiry", async () => {
    const before = Date.now();
    const binding = await createPendingUpload();
    const stored = await getPendingUpload(binding.uploadId);
    expect(stored).toMatchObject({
      id: binding.uploadId,
      nonceHash: hashNonce(binding.nonce),
      pathname: replayPathname(binding.uploadId),
      state: "pending",
      blobUrl: null,
    });
    expect(stored?.nonceHash).not.toBe(binding.nonce);
    expect(stored?.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + PENDING_UPLOAD_TTL_MS,
    );
    expect(stored?.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + PENDING_UPLOAD_TTL_MS,
    );
    expect(await getPendingUpload(randomUUID())).toBeNull();
  });

  it("allows exactly one overlapping claim and keeps that request's Blob URL", async () => {
    const { uploadId } = await createPendingUpload();
    const urls = [
      "https://example.invalid/a.rofl",
      "https://example.invalid/b.rofl",
    ];
    const claims = await Promise.all(
      urls.map((url) => claimPendingUpload(uploadId, url)),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await getPendingUpload(uploadId)).toMatchObject({
      state: "processing",
      blobUrl: urls[claims.indexOf(true)],
    });
    expect(
      await claimPendingUpload(uploadId, "https://example.invalid/again.rofl"),
    ).toBe(false);
  });

  it.each(["processed", "failed"] as const)(
    "never allows a %s upload to be claimed again",
    async (state) => {
      const { uploadId } = await createPendingUpload();
      expect(
        await claimPendingUpload(uploadId, "https://example.invalid/game.rofl"),
      ).toBe(true);
      await finishPendingUpload(uploadId, state);
      expect(await getPendingUpload(uploadId)).toMatchObject({ state });
      expect(
        await claimPendingUpload(
          uploadId,
          "https://example.invalid/retry.rofl",
        ),
      ).toBe(false);
    },
  );

  it("rejects expired and unknown bindings without changing them", async () => {
    const { uploadId } = await createPendingUpload();
    await db
      .update(pendingUploads)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(pendingUploads.id, uploadId));
    expect(
      await claimPendingUpload(
        uploadId,
        "https://example.invalid/expired.rofl",
      ),
    ).toBe(false);
    expect(
      await claimPendingUpload(
        randomUUID(),
        "https://example.invalid/missing.rofl",
      ),
    ).toBe(false);
    expect(await getPendingUpload(uploadId)).toMatchObject({
      state: "pending",
      blobUrl: null,
    });
  });

  it("sweeps rows expired for more than a day while retaining recent expiry and active rows", async () => {
    const old = await createPendingUpload();
    const recent = await createPendingUpload();
    const active = await createPendingUpload();
    await db
      .update(pendingUploads)
      .set({
        expiresAt: new Date(Date.now() - 2 * 86_400_000),
        state: "failed",
      })
      .where(eq(pendingUploads.id, old.uploadId));
    await db
      .update(pendingUploads)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(pendingUploads.id, recent.uploadId));
    const newest = await createPendingUpload();
    expect(await getPendingUpload(old.uploadId)).toBeNull();
    for (const uploadId of [
      recent.uploadId,
      active.uploadId,
      newest.uploadId,
    ]) {
      expect(await getPendingUpload(uploadId)).not.toBeNull();
    }
  });
});
