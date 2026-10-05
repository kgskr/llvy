import { ownerActor } from "@/test/actor";
import { del, list } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  adminCredentials,
  auditLogs,
  games,
  members,
  pendingUploads,
} from "@/db/schema";
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
import { recordAudit } from "./audit";
import type { Actor } from "./auth";

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

async function agedBinding(session: string, actor: Actor = ownerActor) {
  const binding = await createPendingUpload(session, actor);
  await db
    .update(pendingUploads)
    .set({ expiresAt: new Date(Date.now() - 2 * 86_400_000) })
    .where(eq(pendingUploads.id, binding.uploadId));
  return binding;
}

async function terminalLogs(uploadId: string) {
  return db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, "replay.processed"),
        eq(auditLogs.requestId, uploadId),
      ),
    );
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
    expect(await terminalLogs(binding.uploadId)).toEqual([
      expect.objectContaining({
        actorRole: "owner",
        actorName: ownerActor.name,
        targetType: "upload",
        targetId: binding.uploadId,
        requestId: binding.uploadId,
        result: "failure",
        after: { reason: "upload_expired" },
      }),
    ]);
  });

  it("keeps a committed game's Blob even when processing state was lost", async () => {
    const binding = await agedBinding("committed");
    const url = `${origin}/${binding.pathname}`;
    await db
      .update(pendingUploads)
      .set({ state: "processing", blobUrl: url })
      .where(eq(pendingUploads.id, binding.uploadId));
    const [game] = await db
      .insert(games)
      .values({
        fileHash: "committed-hash",
        blobUrl: url,
        playedAt: new Date("2026-10-05T12:00:00Z"),
        playedAtSource: "upload",
      })
      .returning({ id: games.id });

    expect(await reconcileExpiredUploads()).toMatchObject({ removed: 1 });
    expect(list).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(await getPendingUpload(binding.uploadId)).toBeNull();
    expect(await terminalLogs(binding.uploadId)).toEqual([
      expect.objectContaining({
        actorRole: "owner",
        targetId: binding.uploadId,
        requestId: binding.uploadId,
        result: "success",
        after: { gameId: game.id, reason: "reconciled_commit" },
      }),
    ]);
    expect((await db.select().from(games))[0].blobUrl).toBe(url);
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
    expect(await terminalLogs(binding.uploadId)).toHaveLength(0);
    expect(await reconcileExpiredUploads()).toMatchObject({
      failed: 0,
      removed: 1,
    });
    expect(await terminalLogs(binding.uploadId)).toHaveLength(1);
    log.mockRestore();
  });

  it("does not touch fresh bindings", async () => {
    const binding = await createPendingUpload("fresh", ownerActor);
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
    expect(await terminalLogs(binding.uploadId)).toHaveLength(0);
    log.mockRestore();
  });

  it("records abandoned uploads using the stored administrator identity even after revocation and renaming", async () => {
    const [member] = await db
      .insert(members)
      .values({ name: "김이전관리자", birthYear: 1990 })
      .returning();
    const [credential] = await db
      .insert(adminCredentials)
      .values({ memberId: member.id, keyHash: "a".repeat(64) })
      .returning();
    const actor: Actor = {
      role: "admin",
      memberId: member.id,
      credentialId: credential.id,
      name: member.name,
    };
    const binding = await agedBinding("revoked-abandoned", actor);
    await db
      .update(adminCredentials)
      .set({ revokedAt: new Date() })
      .where(eq(adminCredentials.id, credential.id));
    await db
      .update(members)
      .set({ name: "김현재이름" })
      .where(eq(members.id, member.id));

    expect(await reconcileExpiredUploads()).toMatchObject({
      removed: 1,
      failed: 0,
    });
    expect(await terminalLogs(binding.uploadId)).toEqual([
      expect.objectContaining({
        actorRole: "admin",
        actorMemberId: member.id,
        actorCredentialId: credential.id,
        actorName: "김이전관리자",
        requestId: binding.uploadId,
        result: "failure",
        after: { reason: "upload_expired" },
      }),
    ]);
    expect(await getPendingUpload(binding.uploadId)).toBeNull();
    expect(del).not.toHaveBeenCalled();
  });

  it("reconciles legacy bindings with unknown actor metadata", async () => {
    const binding = await agedBinding("legacy-unknown-actor");
    await db
      .update(pendingUploads)
      .set({
        actorRole: null,
        actorName: null,
        actorMemberId: null,
        actorCredentialId: null,
      })
      .where(eq(pendingUploads.id, binding.uploadId));
    expect(await reconcileExpiredUploads()).toMatchObject({
      removed: 1,
      failed: 0,
    });
    expect(await terminalLogs(binding.uploadId)).toEqual([
      expect.objectContaining({
        actorRole: null,
        actorName: null,
        actorMemberId: null,
        actorCredentialId: null,
        requestId: binding.uploadId,
        result: "failure",
      }),
    ]);
  });

  it.each(["success", "failure", "duplicate"] as const)(
    "preserves a prior %s terminal event and does not duplicate logs on retries",
    async (result) => {
      const binding = await agedBinding(`terminal-${result}`);
      await recordAudit(ownerActor, {
        action: "replay.processed",
        targetType: "upload",
        targetId: binding.uploadId,
        requestId: binding.uploadId,
        result,
        after: { reason: "original_terminal_event" },
      });
      const originalLogs = await terminalLogs(binding.uploadId);
      expect(await reconcileExpiredUploads()).toMatchObject({
        removed: 1,
        failed: 0,
      });
      expect(await terminalLogs(binding.uploadId)).toEqual(originalLogs);
      expect(await reconcileExpiredUploads()).toEqual({
        examined: 0,
        removed: 0,
        failed: 0,
      });
      expect(await terminalLogs(binding.uploadId)).toEqual(originalLogs);
    },
  );

  it("keeps a canonical game and its original terminal audit without creating a reconciliation event", async () => {
    const binding = await agedBinding("committed-with-terminal");
    const url = `${origin}/${binding.pathname}`;
    const [game] = await db
      .insert(games)
      .values({
        fileHash: "committed-with-terminal-hash",
        blobUrl: url,
        playedAt: new Date("2026-10-05T12:00:00Z"),
        playedAtSource: "upload",
      })
      .returning({ id: games.id });
    await recordAudit(ownerActor, {
      action: "replay.processed",
      targetType: "upload",
      targetId: binding.uploadId,
      requestId: binding.uploadId,
      result: "success",
      after: { gameId: game.id },
    });
    const originalLogs = await terminalLogs(binding.uploadId);
    expect(await reconcileExpiredUploads()).toMatchObject({
      removed: 1,
      failed: 0,
    });
    expect(list).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(await terminalLogs(binding.uploadId)).toEqual(originalLogs);
    expect(
      await db.select().from(games).where(eq(games.id, game.id)),
    ).toHaveLength(1);
  });

  it("retains the binding when terminal audit insertion fails after Blob deletion and records one event on retry", async () => {
    const binding = await agedBinding("audit-retry");
    const url = `${origin}/${binding.pathname}`;
    vi.mocked(list).mockResolvedValueOnce({
      blobs: [
        {
          url,
          downloadUrl: url,
          pathname: binding.pathname,
          size: 5,
          uploadedAt: new Date(),
          etag: "etag-audit-retry",
        },
      ],
      cursor: undefined,
      hasMore: false,
    });
    await client.exec(`
      CREATE FUNCTION reject_cleanup_test_audit() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'test terminal audit failure'; END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_cleanup_test_audit BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION reject_cleanup_test_audit();
    `);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await reconcileExpiredUploads()).toEqual({
        examined: 1,
        removed: 0,
        failed: 1,
      });
      expect(del).toHaveBeenCalledExactlyOnceWith(url, {
        token: "vercel_blob_rw_test_secret",
      });
      expect(await getPendingUpload(binding.uploadId)).toMatchObject({
        state: "failed",
        cleanupClaimedAt: null,
      });
      expect(await terminalLogs(binding.uploadId)).toHaveLength(0);
    } finally {
      await client.exec(
        "DROP TRIGGER reject_cleanup_test_audit ON audit_logs; DROP FUNCTION reject_cleanup_test_audit();",
      );
      log.mockRestore();
    }
    expect(await reconcileExpiredUploads()).toEqual({
      examined: 1,
      removed: 1,
      failed: 0,
    });
    expect(del).toHaveBeenCalledTimes(1);
    expect(await getPendingUpload(binding.uploadId)).toBeNull();
    expect(await terminalLogs(binding.uploadId)).toEqual([
      expect.objectContaining({
        requestId: binding.uploadId,
        result: "failure",
        after: { reason: "upload_expired" },
      }),
    ]);
    expect(await reconcileExpiredUploads()).toEqual({
      examined: 0,
      removed: 0,
      failed: 0,
    });
    expect(await terminalLogs(binding.uploadId)).toHaveLength(1);
  });

  it("does not delete or log when another cleanup claim replaces this worker's claim", async () => {
    const binding = await agedBinding("replaced-claim");
    const replacementClaim = new Date(Date.now() + 1000);
    vi.mocked(list).mockImplementationOnce(async () => {
      await db
        .update(pendingUploads)
        .set({ cleanupClaimedAt: replacementClaim })
        .where(eq(pendingUploads.id, binding.uploadId));
      return { blobs: [], cursor: undefined, hasMore: false };
    });
    expect(await reconcileExpiredUploads()).toEqual({
      examined: 1,
      removed: 0,
      failed: 0,
    });
    expect(await getPendingUpload(binding.uploadId)).toMatchObject({
      state: "cleaning",
      cleanupClaimedAt: replacementClaim,
    });
    expect(await terminalLogs(binding.uploadId)).toHaveLength(0);
  });
});
