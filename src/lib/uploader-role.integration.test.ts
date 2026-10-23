import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { db } from "@/db";
import {
  client,
  migrateTestDatabase,
  resetTestDatabase,
} from "@/test/database";
import { createTestSession } from "@/test/auth";
import { ownerActor } from "@/test/actor";
import { replayBytes, replayPlayer } from "@/test/replay";
import { del, list } from "@vercel/blob";
import {
  auditLogs,
  authAccounts,
  uploaderGrants,
  games,
  pendingUploads,
  desktopUploadJobs,
  riotAccounts,
  gameParticipants,
} from "@/db/schema";

const mocks = vi.hoisted(() => ({ token: "", fetch: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@vercel/blob", () => ({
  del: vi.fn(async () => {}),
  list: vi.fn(async () => ({ blobs: [], hasMore: false })),
}));
vi.mock("@/db", async () => ({ db: (await import("@/test/database")).db }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: mocks.token }) }),
}));
import {
  grantUploader,
  revokeUploader,
  grantAdministrator,
  revokeAdministrator,
  listLoginAccounts,
} from "./account-administration";
import {
  assertAdmin,
  assertUploader,
  ForbiddenError,
  getSession,
} from "./session";
import { lockUploadAuthority, lockActorAuthority } from "./authority";
import { listAuditLogs, withActorTransaction } from "./audit";
import { createPendingUpload, getPendingUpload } from "./pending-upload-store";
import { matchesUploadActor } from "./upload-actor";
import { ingestReplay } from "./ingest";
import { saveMembership } from "./auth-store";
import { CLIENT_ID, pkce } from "./desktop/protocol";
import {
  startAuthorization,
  approveAuthorization,
  exchangeAuthorization,
  refreshAuthorization,
} from "./desktop/auth-store";
import { credentialActor } from "./desktop/authority";
import { reserveUpload, sessionInfo } from "./desktop/upload-store";
import { processUpload } from "./desktop/process";
import { recordUploadFailure } from "./upload-failure";
import { reconcileExpiredUploads } from "./expired-upload-cleanup";
import { POST as processBrowser } from "@/app/api/process/route";

beforeAll(migrateTestDatabase, 30_000);
beforeEach(async () => {
  await resetTestDatabase();
  mocks.token = (await createTestSession("owner")).token;
  mocks.fetch.mockReset().mockImplementation(async (url: string) =>
    Response.json({
      user: { id: String(url).split("/").at(-1) },
      pending: false,
    }),
  );
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubEnv("DESKTOP_UPLOADER_ENABLED", "true");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_teststore_fixture");
  vi.stubEnv("BLOB_ACCESS", "private");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(() => client.close());

describe("uploader role capability and lifecycle", () => {
  it("lets admin grant and revoke upload without delegating management", async () => {
    const admin = await createTestSession("admin"),
      viewer = await createTestSession("viewer");
    mocks.token = admin.token;
    const id = await grantUploader(viewer.accountId);
    expect(
      (await listLoginAccounts()).accounts.find(
        (a) => a.id === viewer.accountId,
      )?.role,
    ).toBe("uploader");
    mocks.token = viewer.token;
    const actor = await assertUploader();
    expect(actor.uploaderGrantId).toBe(id);
    await expect(assertAdmin()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listLoginAccounts()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listAuditLogs()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      withActorTransaction(actor, async () => true),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const binding = await createPendingUpload(actor.token, actor);
    expect(
      matchesUploadActor(await getPendingUpload(binding.uploadId), actor),
    ).toBe(true);
    mocks.token = admin.token;
    mocks.fetch.mockClear();
    expect(await revokeUploader(viewer.accountId)).toBe(true);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(await revokeUploader(viewer.accountId)).toBe(false);
    mocks.token = viewer.token;
    expect(await getSession()).toBeNull();
    await expect(
      db.transaction((tx) => lockUploadAuthority(tx, actor)),
    ).rejects.toThrow();
    mocks.token = admin.token;
    const nextId = await grantUploader(viewer.accountId);
    expect(nextId).not.toBe(id);
    const renewed = await createTestSession("viewer", {
      userId: viewer.discordUserId,
    });
    mocks.token = renewed.token;
    expect(
      matchesUploadActor(
        await getPendingUpload(binding.uploadId),
        await assertUploader(),
      ),
    ).toBe(false);
  });

  it("forbids uploader changes to admin and owner and admin promotion", async () => {
    const admin = await createTestSession("admin"),
      other = await createTestSession("admin"),
      uploader = await createTestSession("uploader");
    mocks.token = admin.token;
    for (const target of [
      admin.accountId,
      other.accountId,
      ownerActor.accountId,
    ]) {
      await expect(grantUploader(target)).rejects.toThrow();
      await expect(revokeUploader(target)).rejects.toThrow();
    }
    await expect(grantAdministrator(uploader.accountId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(revokeAdministrator(other.accountId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("promotes uploader atomically and does not restore hidden upload authority on demotion", async () => {
    const uploader = await createTestSession("uploader");
    await grantAdministrator(uploader.accountId);
    expect(
      (
        await db
          .select()
          .from(uploaderGrants)
          .where(eq(uploaderGrants.id, uploader.uploaderGrantId!))
      )[0].revokedAt,
    ).not.toBeNull();
    mocks.token = uploader.token;
    expect(await getSession()).toBeNull();
    const renewed = await createTestSession("viewer", {
      userId: uploader.discordUserId,
    });
    mocks.token = renewed.token;
    expect((await getSession())?.role).toBe("admin");
    mocks.token = (await createTestSession("owner")).token;
    await revokeAdministrator(uploader.accountId);
    mocks.token = (
      await createTestSession("viewer", { userId: uploader.discordUserId })
    ).token;
    expect((await getSession())?.role).toBe("viewer");
  });

  it("suspends uploader authority and keeps old sessions dead after rejoining", async () => {
    const uploader = await createTestSession("uploader");
    await saveMembership({
      userId: uploader.discordUserId,
      guildId: process.env.DISCORD_GUILD_ID!,
      status: "absent",
      version: Date.now(),
      checkedAt: new Date(),
    });
    mocks.token = uploader.token;
    expect(await getSession()).toBeNull();
    expect(
      (await db.select().from(uploaderGrants))[0].revokedAt,
    ).not.toBeNull();
    await expect(
      db.transaction((tx) => lockUploadAuthority(tx, uploader)),
    ).rejects.toThrow();
  });

  it("preserves authority on provider outage and rolls back revocation on audit failure", async () => {
    const uploader = await createTestSession("uploader"),
      viewer = await createTestSession("viewer");
    mocks.fetch.mockRejectedValue(new Error("provider unavailable"));
    await expect(grantUploader(viewer.accountId)).rejects.toThrow();
    expect((await db.select().from(uploaderGrants))[0].revokedAt).toBeNull();
    await client.exec(
      "ALTER TABLE audit_logs ADD CONSTRAINT reject_uploader_revoke CHECK (action <> 'uploader.revoked')",
    );
    try {
      await expect(revokeUploader(uploader.accountId)).rejects.toThrow();
      mocks.token = uploader.token;
      expect((await getSession())?.role).toBe("uploader");
    } finally {
      await client.exec(
        "ALTER TABLE audit_logs DROP CONSTRAINT reject_uploader_revoke",
      );
    }
  });

  it("rolls back uploader grants when audit insertion fails", async () => {
    const viewer = await createTestSession("viewer");
    await client.exec(
      "ALTER TABLE audit_logs ADD CONSTRAINT reject_uploader_audit CHECK (action <> 'uploader.granted')",
    );
    try {
      await expect(grantUploader(viewer.accountId)).rejects.toThrow();
      expect(await db.select().from(uploaderGrants)).toEqual([]);
    } finally {
      await client.exec(
        "ALTER TABLE audit_logs DROP CONSTRAINT reject_uploader_audit",
      );
    }
  });
});

describe("uploader replay attribution", () => {
  it("stores separate submitters and filenames for success and duplicate and preserves history after deletion", async () => {
    const first = await createTestSession("uploader"),
      second = await createTestSession("uploader");
    const bytes = replayBytes();
    let gameId = "";
    for (const [index, actor] of [first, second].entries()) {
      const reservation = await createPendingUpload(actor.token, actor);
      const result = await ingestReplay({
        bytes,
        lastModified: null,
        actor,
        uploadId: reservation.uploadId,
        originalFilename: `C:\\Replays\\game-${index}.rofl`,
        blobUrl: `https://teststore.private.blob.vercel-storage.com/${reservation.pathname}`,
      });
      gameId = result.gameId;
      expect(result.duplicate).toBe(index === 1);
      const [event] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, "replay.processed"),
            eq(auditLogs.requestId, reservation.uploadId),
          ),
        );
      expect(event).toMatchObject({
        actorAccountId: actor.accountId,
        actorRole: "uploader",
        actorUploaderGrantId: actor.uploaderGrantId,
        result: index ? "duplicate" : "success",
        after: {
          gameId,
          originalFilename: `game-${index}.rofl`,
          fileHash: createHash("sha256").update(bytes).digest("hex"),
          channel: "browser",
        },
      });
    }
    const before = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "replay.processed"));
    await revokeUploader(first.accountId);
    await db
      .update(authAccounts)
      .set({ displayName: "Renamed" })
      .where(eq(authAccounts.id, first.accountId));
    await db.delete(pendingUploads);
    await db.delete(games).where(eq(games.id, gameId));
    expect(
      await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, "replay.processed")),
    ).toEqual(before);
    expect(
      (await listAuditLogs())
        .filter((e) => e.action === "replay.processed")
        .every((e) => !e.gameExists),
    ).toBe(true);
  });

  it("authorizes uploader desktop, persists file audit, and rejects revoked refresh and approvals", async () => {
    const actor = await createTestSession("uploader");
    const verifier = "v".repeat(43),
      redirectUri = "http://127.0.0.1:43123/callback";
    async function approve() {
      const request = await startAuthorization(
        {
          clientId: CLIENT_ID,
          redirectUri,
          state: Buffer.alloc(32, 7).toString("base64url"),
          codeChallenge: pkce(verifier),
          codeChallengeMethod: "S256",
          mode: "persistent",
        },
        crypto.randomUUID(),
      );
      const callback = await approveAuthorization(
        actor,
        request.requestId,
        "approve",
      );
      return {
        clientId: CLIENT_ID,
        redirectUri,
        code: new URL(callback!).searchParams.get("code")!,
        codeVerifier: verifier,
      };
    }
    const tokens = await exchangeAuthorization(
      await approve(),
      crypto.randomUUID(),
    );
    const device = await credentialActor(tokens.accessToken, "access");
    expect((await sessionInfo(device)).account.role).toBe("uploader");
    await expect(
      db.transaction((tx) => lockActorAuthority(tx, device)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const bytes = replayBytes();
    const metadata = {
      filename: "KR_123456.rofl",
      size: bytes.length,
      lastModified: Date.now(),
      clientSha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const reservation = await reserveUpload(
      device,
      metadata,
      crypto.randomUUID(),
    );
    mocks.fetch.mockImplementation(
      async (_url: string, options?: RequestInit) =>
        options?.method === "HEAD"
          ? new Response(null, { status: 200 })
          : new Response(new Uint8Array(bytes)),
    );
    expect(
      (await processUpload(device, reservation.uploadId, reservation.nonce))
        .state,
    ).toBe("completed");
    const [event] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, "replay.processed"),
          eq(auditLogs.requestId, reservation.uploadId),
        ),
      );
    expect(event.after).toMatchObject({
      originalFilename: metadata.filename,
      fileHash: metadata.clientSha256,
      channel: "desktop",
      deviceSessionId: device.deviceSessionId,
    });
    const invalidBytes = new Uint8Array(256);
    const invalidHash = createHash("sha256").update(invalidBytes).digest("hex");
    const invalid = await reserveUpload(
      device,
      {
        ...metadata,
        filename: "invalid.rofl",
        size: invalidBytes.length,
        clientSha256: invalidHash,
      },
      crypto.randomUUID(),
    );
    mocks.fetch.mockImplementation(
      async (_url: string, options?: RequestInit) =>
        options?.method === "HEAD"
          ? new Response(null, { status: 200 })
          : new Response(invalidBytes),
    );
    await expect(
      processUpload(device, invalid.uploadId, invalid.nonce),
    ).rejects.toThrow();
    expect(
      (await processUpload(device, invalid.uploadId, invalid.nonce)).state,
    ).toBe("failed");
    const failedEvents = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, "replay.processed"),
          eq(auditLogs.requestId, invalid.uploadId),
        ),
      );
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0]).toMatchObject({
      actorUploaderGrantId: actor.uploaderGrantId,
      result: "failure",
      after: {
        originalFilename: "invalid.rofl",
        fileHash: invalidHash,
        reason: "invalid_replay",
      },
    });
    const pending = await approve();
    await revokeUploader(actor.accountId);
    await expect(
      exchangeAuthorization(pending, crypto.randomUUID()),
    ).rejects.toThrow();
    await expect(
      refreshAuthorization(
        { refreshToken: tokens.refreshToken },
        crypto.randomUUID(),
      ),
    ).rejects.toThrow();
    await expect(sessionInfo(device)).rejects.toThrow();
  });
});

async function terminalEvents(uploadId: string) {
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
async function expireAndReconcile(uploadId: string) {
  await db
    .update(pendingUploads)
    .set({ expiresAt: new Date(Date.now() - 2 * 86_400_000) })
    .where(eq(pendingUploads.id, uploadId));
  expect((await reconcileExpiredUploads()).failed).toBe(0);
}
async function deviceFor(actor: Awaited<ReturnType<typeof createTestSession>>) {
  const verifier = "v".repeat(43),
    redirectUri = "http://127.0.0.1:43123/callback";
  const request = await startAuthorization(
    {
      clientId: CLIENT_ID,
      redirectUri,
      state: Buffer.alloc(32, 7).toString("base64url"),
      codeChallenge: pkce(verifier),
      codeChallengeMethod: "S256",
      mode: "persistent",
    },
    crypto.randomUUID(),
  );
  const callback = await approveAuthorization(
    actor,
    request.requestId,
    "approve",
  );
  const tokens = await exchangeAuthorization(
    {
      clientId: CLIENT_ID,
      redirectUri,
      code: new URL(callback!).searchParams.get("code")!,
      codeVerifier: verifier,
    },
    crypto.randomUUID(),
  );
  return credentialActor(tokens.accessToken, "access");
}

describe("durable upload failure attribution", () => {
  for (const channel of ["browser", "desktop"] as const) {
    it.each([
      "PUUID",
      "RIOT_ID_GAME_NAME",
      "RIOT_ID_TAG_LINE",
      "gameVersion",
      "SKIN",
      ...(channel === "browser" ? ["originalFilename"] : []),
    ])(
      `${channel} rejects oversized %s with a terminal audit and no replay writes`,
      async (field) => {
        const actor = await createTestSession("uploader");
        mocks.token = actor.token;
        const bytes = replayBytes({
          format: "rofl2",
          players: [replayPlayer({ [field]: "x".repeat(6000) })],
          metadata:
            field === "gameVersion"
              ? { gameVersion: "x".repeat(1024 * 1024) }
              : {},
        });
        const hash = createHash("sha256").update(bytes).digest("hex");
        const device = channel === "desktop" ? await deviceFor(actor) : null;
        const reservation = device
          ? await reserveUpload(
              device,
              {
                filename: "oversized.rofl",
                size: bytes.length,
                lastModified: Date.now(),
                clientSha256: hash,
              },
              crypto.randomUUID(),
            )
          : await createPendingUpload(actor.token, actor, "oversized.rofl");
        const pending = await getPendingUpload(reservation.uploadId);
        const blobUrl = `https://teststore.private.blob.vercel-storage.com/${pending!.pathname}`;
        vi.mocked(del).mockClear();
        mocks.fetch.mockImplementation(
          async (_url: string, options?: RequestInit) =>
            options?.method === "HEAD"
              ? new Response(null)
              : new Response(new Uint8Array(bytes)),
        );
        if (device) {
          await expect(
            processUpload(device, reservation.uploadId, reservation.nonce),
          ).rejects.toMatchObject({ code: "invalid_replay", status: 422 });
          expect(
            (
              await processUpload(
                device,
                reservation.uploadId,
                reservation.nonce,
              )
            ).state,
          ).toBe("failed");
        } else {
          const response = await processBrowser(
            new Request("http://localhost/api/process", {
              method: "POST",
              body: JSON.stringify({
                ...reservation,
                blobUrl,
                ...(field === "originalFilename"
                  ? { originalFilename: "x".repeat(1024 * 1024) + ".rofl" }
                  : {}),
              }),
            }),
          );
          expect(response.status).toBe(422);
          expect(await response.json()).toMatchObject({
            error: expect.stringContaining("storage limit"),
          });
        }
        const events = await terminalEvents(reservation.uploadId);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          actorAccountId: actor.accountId,
          actorUploaderGrantId: actor.uploaderGrantId,
          result: "failure",
          after: {
            originalFilename:
              field === "originalFilename" ? "x".repeat(256) : "oversized.rofl",
            fileHash: hash,
            reason: "invalid_replay",
            channel,
          },
        });
        expect((await getPendingUpload(reservation.uploadId))?.state).toBe(
          "failed",
        );
        if (device) {
          // Desktop failures delegate orphan deletion to bounded maintenance.
          expect(del).not.toHaveBeenCalled();
          vi.mocked(list).mockResolvedValueOnce({
            blobs: [
              {
                url: blobUrl,
                downloadUrl: blobUrl,
                pathname: pending!.pathname,
                size: bytes.length,
                uploadedAt: new Date(),
                etag: "oversized-fixture",
              },
            ],
            hasMore: false,
            cursor: undefined,
          });
          await expireAndReconcile(reservation.uploadId);
          expect(await terminalEvents(reservation.uploadId)).toEqual(events);
        }
        expect(vi.mocked(del).mock.calls.map(([url]) => url)).toEqual([
          blobUrl,
        ]);
        expect(await db.select().from(games)).toEqual([]);
        expect(await db.select().from(riotAccounts)).toEqual([]);
        expect(await db.select().from(gameParticipants)).toEqual([]);
      },
    );
  }

  it.each(["ascii", "multibyte", "null"])(
    "stores boundary normalized metadata and %s filename unchanged",
    async (kind) => {
      const filename =
        kind === "null"
          ? null
          : kind === "ascii"
            ? "f".repeat(1019) + ".rofl"
            : "가".repeat(339) + "ab.rofl";
      const version = "가".repeat(85) + "a";
      const result = await ingestReplay({
        bytes: replayBytes({
          metadata: { gameVersion: version },
          players: [replayPlayer({ SKIN: version })],
        }),
        originalFilename: filename,
        blobUrl:
          "https://teststore.private.blob.vercel-storage.com/boundary.rofl",
        lastModified: null,
      });
      const [game] = await db
        .select()
        .from(games)
        .where(eq(games.id, result.gameId));
      expect(game).toMatchObject({
        gameVersion: version,
        originalFilename: filename,
      });
      expect((await db.select().from(gameParticipants))[0].champion).toBe(
        version,
      );
      if (filename !== null) {
        // Reject before even the duplicate branch can persist an audit value.
        await expect(
          ingestReplay({
            bytes: replayBytes({
              metadata: { gameVersion: version },
              players: [replayPlayer({ SKIN: version })],
            }),
            originalFilename: filename + "a",
            blobUrl:
              "https://teststore.private.blob.vercel-storage.com/duplicate.rofl",
            lastModified: null,
          }),
        ).rejects.toThrow(/filename exceeds/);
        expect(await db.select().from(games)).toHaveLength(1);
      }
    },
  );

  it.each(["legacy", "puuid"] as const)(
    "persists boundary identities using the %s index",
    async (identityKind) => {
      const puuid = identityKind === "legacy" ? null : "p".repeat(512);
      const name = "가".repeat(170) + "ab";
      const tag = "t".repeat(512);
      await ingestReplay({
        bytes: replayBytes({
          players: [
            replayPlayer({
              PUUID: puuid,
              RIOT_ID_GAME_NAME: name,
              RIOT_ID_TAG_LINE: tag,
            }),
          ],
        }),
        blobUrl:
          "https://teststore.private.blob.vercel-storage.com/boundary.rofl",
        originalFilename: "boundary.rofl",
        lastModified: null,
      });
      expect(await db.select().from(riotAccounts)).toEqual([
        expect.objectContaining({ puuid, gameName: name, tagLine: tag }),
      ]);
      expect(await db.select().from(gameParticipants)).toHaveLength(1);
    },
  );

  it("uses the reserved filename when the browser process body omits it and protects a committed outcome", async () => {
    const actor = await createTestSession("uploader");
    mocks.token = actor.token;
    const reservation = await createPendingUpload(
      actor.token,
      actor,
      "reserved.rofl",
    );
    mocks.fetch.mockResolvedValue(new Response(new Uint8Array(replayBytes())));
    const response = await processBrowser(
      new Request("http://localhost/api/process", {
        method: "POST",
        body: JSON.stringify({
          ...reservation,
          blobUrl: `https://teststore.private.blob.vercel-storage.com/${reservation.pathname}`,
        }),
      }),
    );
    expect(response.status).toBe(200);
    const events = await terminalEvents(reservation.uploadId);
    expect(events[0].after).toMatchObject({
      originalFilename: "reserved.rofl",
    });
    await recordUploadFailure({
      uploadId: reservation.uploadId,
      nonce: reservation.nonce,
      actor,
      reason: "invalid_replay",
      originalFilename: "wrong.rofl",
    });
    expect(await terminalEvents(reservation.uploadId)).toEqual(events);
    expect((await getPendingUpload(reservation.uploadId))?.state).toBe(
      "processed",
    );
  });

  it("retains the computed browser hash when membership suspension retires its claim during download", async () => {
    const actor = await createTestSession("uploader");
    mocks.token = actor.token;
    const reservation = await createPendingUpload(
      actor.token,
      actor,
      "left.rofl",
    );
    const bytes = replayBytes(),
      hash = createHash("sha256").update(bytes).digest("hex");
    mocks.fetch.mockImplementation(async () => {
      await saveMembership({
        userId: actor.discordUserId,
        guildId: process.env.DISCORD_GUILD_ID!,
        status: "absent",
        version: Date.now(),
        checkedAt: new Date(),
      });
      return new Response(new Uint8Array(bytes));
    });
    const response = await processBrowser(
      new Request("http://localhost/api/process", {
        method: "POST",
        body: JSON.stringify({
          ...reservation,
          blobUrl: `https://teststore.private.blob.vercel-storage.com/${reservation.pathname}`,
        }),
      }),
    );
    expect(response.status).toBe(403);
    const events = await terminalEvents(reservation.uploadId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      result: "failure",
      after: {
        reason: "authority_revoked",
        fileHash: hash,
        originalFilename: "left.rofl",
      },
    });
  });

  it("recovers a browser parse failure and server hash after audit insertion recovers, with safe Unicode", async () => {
    const actor = await createTestSession("uploader");
    mocks.token = actor.token;
    const reservation = await createPendingUpload(
      actor.token,
      actor,
      "reserved.rofl",
    );
    const bytes = new Uint8Array(256),
      hash = createHash("sha256").update(bytes).digest("hex");
    mocks.fetch.mockResolvedValue(new Response(bytes));
    await client.exec(
      "ALTER TABLE audit_logs ADD CONSTRAINT fail_terminal CHECK (action <> 'replay.processed')",
    );
    try {
      const response = await processBrowser(
        new Request("http://localhost/api/process", {
          method: "POST",
          body: JSON.stringify({
            ...reservation,
            blobUrl: `https://teststore.private.blob.vercel-storage.com/${reservation.pathname}`,
            originalFilename: "C:\\replays\\bad\ud800.rofl",
          }),
        }),
      );
      expect(response.status).toBe(422);
      expect(await terminalEvents(reservation.uploadId)).toHaveLength(0);
      expect(
        (await getPendingUpload(reservation.uploadId))?.auditMetadata,
      ).toEqual({
        originalFilename: "bad\ufffd.rofl",
        failure: { reason: "invalid_replay", fileHash: hash },
      });
    } finally {
      await client.exec("ALTER TABLE audit_logs DROP CONSTRAINT fail_terminal");
    }
    mocks.token = (await createTestSession("owner")).token;
    await revokeUploader(actor.accountId);
    await db
      .update(authAccounts)
      .set({ displayName: "Renamed" })
      .where(eq(authAccounts.id, actor.accountId));
    await expireAndReconcile(reservation.uploadId);
    const events = await terminalEvents(reservation.uploadId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorName: actor.name,
      actorUploaderGrantId: actor.uploaderGrantId,
      result: "failure",
      after: {
        originalFilename: "bad\ufffd.rofl",
        fileHash: hash,
        reason: "invalid_replay",
        channel: "browser",
      },
    });
  });

  it.each(["revoked", "audit_unavailable"])(
    "retains desktop processing failure after %s",
    async (mode) => {
      const actor = await createTestSession("uploader"),
        device = await deviceFor(actor);
      const bytes = mode === "revoked" ? replayBytes() : new Uint8Array(256);
      const hash = createHash("sha256").update(bytes).digest("hex");
      const reservation = await reserveUpload(
        device,
        {
          filename: "desktop.rofl",
          size: bytes.length,
          lastModified: Date.now(),
          clientSha256: hash,
        },
        crypto.randomUUID(),
      );
      mocks.fetch.mockImplementation(
        async (_url: string, options?: RequestInit) => {
          if (options?.method === "HEAD") return new Response(null);
          if (mode === "revoked") await revokeUploader(actor.accountId);
          return new Response(new Uint8Array(bytes));
        },
      );
      if (mode === "audit_unavailable")
        await client.exec(
          "ALTER TABLE audit_logs ADD CONSTRAINT fail_terminal CHECK (action <> 'replay.processed')",
        );
      try {
        await expect(
          processUpload(device, reservation.uploadId, reservation.nonce),
        ).rejects.toThrow();
      } finally {
        if (mode === "audit_unavailable")
          await client.exec(
            "ALTER TABLE audit_logs DROP CONSTRAINT fail_terminal",
          );
      }
      expect(
        (await getPendingUpload(reservation.uploadId))?.auditMetadata,
      ).toEqual({
        originalFilename: "desktop.rofl",
        failure: {
          reason: mode === "revoked" ? "authority_revoked" : "invalid_replay",
          fileHash: hash,
        },
      });
      await expireAndReconcile(reservation.uploadId);
      const events = await terminalEvents(reservation.uploadId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorUploaderGrantId: actor.uploaderGrantId,
        result: "failure",
        after: {
          fileHash: hash,
          originalFilename: "desktop.rofl",
          channel: "desktop",
          deviceSessionId: device.deviceSessionId,
          reason: mode === "revoked" ? "authority_revoked" : "invalid_replay",
        },
      });
      expect(
        (
          await db
            .select()
            .from(desktopUploadJobs)
            .where(eq(desktopUploadJobs.id, reservation.uploadId))
        )[0].state,
      ).toBe("failed");
    },
  );
});
