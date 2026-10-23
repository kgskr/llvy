import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
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
import {
  client,
  db,
  migrateTestDatabase,
  resetTestDatabase,
} from "@/test/database";
import { ownerActor } from "@/test/actor";
import { createTestSession } from "@/test/auth";
import { replayBytes } from "@/test/replay";
import {
  auditLogs,
  authSessions,
  desktopAuthRequests,
  desktopCredentials,
  desktopSessions,
  desktopUploadJobs,
  games,
  gameParticipants,
  pendingUploads,
  requestBudgets,
} from "@/db/schema";
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => ({ db: (await import("@/test/database")).db }));
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
import { CLIENT_ID, pkce, validateStart, validateUpload } from "./protocol";
import {
  BudgetExceeded,
  budgetKey,
  consumeRequestBudgets,
} from "@/lib/request-budget";
import {
  startAuthorization,
  approveAuthorization,
  exchangeAuthorization,
  refreshAuthorization,
  revokeOwnAccess,
  listOwnDevices,
  revokeOwnDevice,
} from "./auth-store";
import { credentialActor } from "./authority";
import { reserveUpload, sessionInfo, uploadStatus } from "./upload-store";
import { processUpload, ingestionFinalizer } from "./process";
import {
  cleanupDesktopAuthentication,
  revokeAllDesktopConnections,
} from "./maintenance";
import { withActorTransaction } from "@/lib/audit";
import { ingestReplay } from "@/lib/ingest";
import { createPendingUpload } from "@/lib/pending-upload-store";
import { endpoint, body, device } from "./http";
import { GET as sessionRoute } from "@/app/api/desktop/v1/session/route";
import { POST as reserveRoute } from "@/app/api/desktop/v1/uploads/route";
const verifier = "v".repeat(43),
  state = Buffer.alloc(32, 7).toString("base64url"),
  redirectUri = "http://127.0.0.1:43123/callback";
const input = {
  clientId: CLIENT_ID,
  redirectUri,
  state,
  codeChallenge: pkce(verifier),
  codeChallengeMethod: "S256",
  mode: "persistent",
};
const bytes = replayBytes();
const metadata = {
  filename: "KR_123456.rofl",
  size: bytes.length,
  lastModified: Date.now(),
  clientSha256: createHash("sha256").update(bytes).digest("hex"),
};
async function approved(
  actor = ownerActor,
  mode = "persistent",
  replacement?: string,
) {
  const request = await startAuthorization(
    { ...input, mode },
    crypto.randomUUID(),
  );
  const callback = await approveAuthorization(
    actor,
    request.requestId,
    "approve",
    replacement,
  );
  const code = new URL(callback!).searchParams.get("code")!;
  return {
    request,
    body: { clientId: CLIENT_ID, redirectUri, code, codeVerifier: verifier },
  };
}
async function connect(
  actor = ownerActor,
  mode = "persistent",
  replacement?: string,
) {
  const { body } = await approved(actor, mode, replacement);
  return exchangeAuthorization(body, crypto.randomUUID());
}
async function setup() {
  const tokens = await connect();
  return { tokens, actor: await credentialActor(tokens.accessToken, "access") };
}
beforeAll(migrateTestDatabase);
beforeEach(async () => {
  await resetTestDatabase();
  vi.stubEnv("DESKTOP_UPLOADER_ENABLED", "true");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_teststore_fixture");
  vi.stubEnv("BLOB_ACCESS", "private");
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(() => client.close());
describe("desktop authorization and isolation", () => {
  it("keeps all active devices visible ahead of more than 100 inactive connections", async () => {
    const { tokens } = await setup();
    const now = Date.now(),
      expiresAt = new Date(now + 30 * 86400000);
    // An older active device must remain visible as well as a newer one.
    await db
      .update(desktopSessions)
      .set({ createdAt: new Date(now - 86400000) })
      .where(eq(desktopSessions.id, tokens.deviceSessionId));
    const ids = Array.from({ length: 105 }, () => crypto.randomUUID());
    await db.insert(authSessions).values(
      ids.map((id) => ({
        id,
        accountId: ownerActor.accountId,
        guildId: "222222222222222222",
        referenceHash: id,
        kind: "desktop",
        expiresAt,
        revokedAt: new Date(now),
      })),
    );
    await db.insert(desktopSessions).values(
      ids.map((id, i) => ({
        id,
        accountId: ownerActor.accountId,
        role: "owner",
        mode: "persistent",
        scopes: "replay:upload replay:status",
        expiresAt,
        createdAt: new Date(now - 1000 + i),
        revokedAt: new Date(now),
      })),
    );
    const newest = await connect(ownerActor, "transient");
    await cleanupDesktopAuthentication();
    const listed = await listOwnDevices(ownerActor);
    expect(listed).toHaveLength(100);
    expect(listed.slice(0, 2).every((d) => d.active)).toBe(true);
    expect(
      listed
        .filter((d) => d.active)
        .map((d) => d.id)
        .sort(),
    ).toEqual([tokens.deviceSessionId, newest.deviceSessionId].sort());
    const replacement = await connect(
      ownerActor,
      "transient",
      newest.deviceSessionId,
    );
    await revokeOwnDevice(ownerActor, tokens.deviceSessionId);
    expect(
      (await listOwnDevices(ownerActor))
        .filter((d) => d.active)
        .map((d) => d.id),
    ).toEqual([replacement.deviceSessionId]);
  });
  it("drains expired requests during starts, with bounded batches and active approval preservation", async () => {
    const approvedRequest = await approved();
    const now = Date.now();
    await db.insert(desktopAuthRequests).values(
      Array.from({ length: 521 }, (_, i) => ({
        clientId: CLIENT_ID,
        redirectUri,
        state,
        challenge: pkce(verifier),
        mode: "transient",
        expiresAt: new Date(now - 10000 + i),
      })),
    );
    for (let i = 0; i < 3; i++)
      await startAuthorization(input, "cleanup-regression");
    const rows = await db.select().from(desktopAuthRequests);
    expect(rows.filter((r) => r.expiresAt.getTime() <= now)).toHaveLength(491);
    expect(rows.filter((r) => r.expiresAt.getTime() > now)).toHaveLength(4);
    expect((await cleanupDesktopAuthentication()).requests).toBe(491);
    expect(await db.select().from(desktopAuthRequests)).toHaveLength(4);
    await expect(
      exchangeAuthorization(approvedRequest.body, "cleanup-regression"),
    ).resolves.toMatchObject({ protocol: "desktop-v1" });
  });

  it("validates literal loopback, mode, S256 and metadata strictly", () => {
    expect(validateStart(input).mode).toBe("persistent");
    for (const uri of [
      "http://localhost:123/callback",
      "http://127.0.0.1:0/callback",
      "http://127.0.0.1:99999/callback",
      "http://127.0.0.1:123/callback?a=b",
      "https://127.0.0.1:123/callback",
    ])
      expect(() => validateStart({ ...input, redirectUri: uri })).toThrow();
    expect(() =>
      validateUpload({ ...metadata, blobUrl: "https://example.invalid" }),
    ).toThrow();
    expect(() => validateUpload({ ...metadata, size: 0 })).toThrow();
  });
  it("consumes PKCE code once, stores only hashes, rejects browser mutation use", async () => {
    const { body } = await approved();
    await expect(
      exchangeAuthorization({ ...body, codeVerifier: "z".repeat(43) }, "ip"),
    ).rejects.toThrow("invalid_grant");
    const tokens = await exchangeAuthorization(body, "ip");
    await expect(exchangeAuthorization(body, "ip")).rejects.toThrow(
      "invalid_grant",
    );
    const actor = await credentialActor(tokens.accessToken, "access");
    expect((await sessionInfo(actor)).protocol).toBe("desktop-v1");
    await expect(
      withActorTransaction(actor, async () => null),
    ).rejects.toThrow();
    await expect(
      credentialActor(tokens.refreshToken, "access"),
    ).rejects.toThrow();
    expect(
      JSON.stringify(await db.select().from(desktopCredentials)),
    ).not.toContain(tokens.refreshToken);
    const [event] = await db.select().from(auditLogs);
    expect(event.after).toMatchObject({
      deviceSessionId: actor.deviceSessionId,
      channel: "desktop",
      mode: "persistent",
    });
  });
  it("checks browser authority again at exchange, and rejects viewers", async () => {
    const { body } = await approved();
    await db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(eq(authSessions.id, ownerActor.sessionId));
    await expect(exchangeAuthorization(body, "ip")).rejects.toThrow();
    const viewer = await createTestSession("viewer");
    await expect(approved(viewer)).rejects.toThrow();
    expect(await listOwnDevices(viewer)).toEqual([]);
  });
  it("rotates within absolute lifetime; replay survives cleanup and revokes the family", async () => {
    const { tokens } = await setup();
    const next = await refreshAuthorization(
      { refreshToken: tokens.refreshToken },
      "ip",
    );
    expect(next.deviceExpiresAt).toBe(tokens.deviceExpiresAt);
    await cleanupDesktopAuthentication();
    await expect(
      refreshAuthorization({ refreshToken: tokens.refreshToken }, "ip"),
    ).rejects.toThrow("refresh_reused");
    await expect(
      sessionInfo(await credentialActor(next.accessToken, "access")),
    ).rejects.toThrow();
    expect(
      (await db.select().from(desktopSessions))[0].revokedAt,
    ).not.toBeNull();
  });
  it("atomically enforces five devices and explicit transient replacement", async () => {
    const first = await connect(ownerActor, "transient");
    for (let i = 0; i < 4; i++) await connect();
    const full = await approved();
    await expect(exchangeAuthorization(full.body, "ip")).rejects.toThrow(
      "device_limit",
    );
    const next = await connect(ownerActor, "persistent", first.deviceSessionId);
    expect(next.deviceSessionId).not.toBe(first.deviceSessionId);
    await expect(
      sessionInfo(await credentialActor(first.accessToken, "access")),
    ).rejects.toThrow();
    expect(
      (await db.select().from(desktopSessions)).filter((d) => !d.revokedAt),
    ).toHaveLength(5);
  });
  it("disables operations but permits own refresh-token revocation; preserves browser", async () => {
    const { tokens, actor } = await setup();
    vi.stubEnv("DESKTOP_UPLOADER_ENABLED", "false");
    await expect(sessionInfo(actor)).rejects.toThrow("desktop_disabled");
    await revokeOwnAccess(tokens.refreshToken);
    expect(
      (
        await db
          .select()
          .from(authSessions)
          .where(eq(authSessions.id, ownerActor.sessionId))
      )[0].revokedAt,
    ).toBeNull();
  });
  it("bulk revocation survives owner rollback and preserves browser sessions", async () => {
    const { tokens } = await setup();
    await startAuthorization(input, "ip");
    vi.stubEnv("DESKTOP_UPLOADER_ENABLED", "false");
    await revokeAllDesktopConnections();
    vi.stubEnv("DESKTOP_UPLOADER_ENABLED", "true");
    await expect(
      sessionInfo(await credentialActor(tokens.accessToken, "access")),
    ).rejects.toThrow();
    expect(
      (await db.select().from(desktopAuthRequests)).every(
        (r) => !["pending", "approved"].includes(r.status),
      ),
    ).toBe(true);
  });
  it("cannot revoke or inspect another account/device", async () => {
    const { actor } = await setup();
    const binding = await reserveUpload(actor, metadata, "idempotency-key-1");
    const other = await createTestSession("admin");
    await revokeOwnDevice(other, actor.deviceSessionId);
    expect((await sessionInfo(actor)).deviceSessionId).toBe(
      actor.deviceSessionId,
    );
    const second = await connect();
    await expect(
      uploadStatus(
        await credentialActor(second.accessToken, "access"),
        binding.uploadId,
      ),
    ).rejects.toThrow("not_found");
  });
});
describe("reservations, finalizers and uncertain responses", () => {
  it.each(["account", "global", "both"])(
    "uses the rejecting %s window reset and rolls back all reservation writes",
    async (exhausted) => {
      const { actor, tokens } = await setup();
      const now = Date.now();
      const accountKey = budgetKey("upload:account", actor.accountId);
      const counters = [
        {
          key: accountKey,
          count: exhausted === "global" ? 3 : 10,
          resetAt: new Date(now + (exhausted === "global" ? 60_000 : 10_500)),
        },
        {
          key: "upload:global",
          count: exhausted === "account" ? 3 : 50,
          resetAt: new Date(now + (exhausted === "both" ? 45_000 : 10_500)),
        },
      ];
      await db.insert(requestBudgets).values(counters);
      const auditBefore = await db.select().from(auditLogs);
      const clock = vi.spyOn(Date, "now").mockReturnValue(now);
      try {
        const response = await reserveRoute(
          new Request("https://example.invalid/api/desktop/v1/uploads", {
            method: "POST",
            headers: {
              authorization: `Bearer ${tokens.accessToken}`,
              "content-type": "application/json",
              "idempotency-key": "near-reset-reservation",
            },
            body: JSON.stringify(metadata),
          }),
        );
        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).toBe("11");
        expect((await response.json()).error.code).toBe("quota_exhausted");
        for (const counter of counters) {
          const [actual] = await db
            .select()
            .from(requestBudgets)
            .where(eq(requestBudgets.key, counter.key));
          expect(actual.count).toBe(counter.count);
          expect(actual.resetAt).toEqual(counter.resetAt);
        }
        expect(await db.select().from(pendingUploads)).toHaveLength(0);
        expect(await db.select().from(desktopUploadJobs)).toHaveLength(0);
        expect(await db.select().from(auditLogs)).toEqual(auditBefore);
        expect(
          await consumeRequestBudgets([
            {
              key: exhausted === "global" ? "upload:global" : accountKey,
              limit: exhausted === "global" ? 50 : 10,
              windowMs: 86_400_000,
            },
          ]),
        ).toBe(false);
      } finally {
        clock.mockRestore();
      }
    },
  );
  it.each([
    [undefined, null],
    [new Date(NaN), null],
    [new Date(999), "1"],
    [new Date(1000), "1"],
    [new Date(1001), "1"],
    [new Date(2501), "2"],
  ] as const)(
    "bounds quota retry delay for reset %s",
    async (resetAt, expected) => {
      const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
      try {
        const response = await endpoint(async () => {
          throw new BudgetExceeded(resetAt);
        });
        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).toBe(expected);
      } finally {
        clock.mockRestore();
      }
    },
  );

  it("recovers nonce without quota debit, rejects changed input, shares web quotas", async () => {
    const { actor } = await setup();
    const binding = await reserveUpload(actor, metadata, "idempotency-key-1");
    expect(await reserveUpload(actor, metadata, "idempotency-key-1")).toEqual(
      binding,
    );
    await expect(
      reserveUpload(actor, { ...metadata, size: 1 }, "idempotency-key-1"),
    ).rejects.toThrow("idempotency_conflict");
    for (let i = 0; i < 9; i++)
      await createPendingUpload("browser", ownerActor);
    await expect(
      reserveUpload(actor, metadata, "idempotency-key-2"),
    ).rejects.toThrow();
    expect(
      (await db.select().from(requestBudgets))
        .filter((r) => r.key.startsWith("upload:"))
        .map((r) => r.count),
    ).toEqual([10, 10]);
  });
  it("rolls back budget, pending and job when audit insertion fails", async () => {
    const { actor } = await setup();
    await client.exec(
      "ALTER TABLE audit_logs ADD CONSTRAINT fail_reserve CHECK (action <> 'replay.reserved')",
    );
    try {
      await expect(
        reserveUpload(actor, metadata, "idempotency-key-1"),
      ).rejects.toThrow();
      expect(await db.select().from(pendingUploads)).toHaveLength(0);
      expect(await db.select().from(desktopUploadJobs)).toHaveLength(0);
      expect(
        (await db.select().from(requestBudgets)).filter((r) =>
          r.key.startsWith("upload:"),
        ),
      ).toHaveLength(0);
    } finally {
      await client.exec("ALTER TABLE audit_logs DROP CONSTRAINT fail_reserve");
    }
  });
  it("keeps day-eight idempotency tombstones without file details or new debits", async () => {
    const { actor } = await setup();
    const b = await reserveUpload(actor, metadata, "idempotency-key-1");
    await db
      .update(desktopUploadJobs)
      .set({ resultExpiresAt: new Date(0), reservationExpiresAt: new Date(0) })
      .where(eq(desktopUploadJobs.id, b.uploadId));
    await cleanupDesktopAuthentication();
    expect((await db.select().from(desktopUploadJobs))[0].filename).toBeNull();
    await expect(
      reserveUpload(actor, metadata, "idempotency-key-1"),
    ).rejects.toThrow("reservation_expired");
    expect((await sessionInfo(actor)).quota.account.remaining).toBe(9);
  });
  it("404 HEAD leaves pending; 503 is not evidence of absence", async () => {
    const { actor } = await setup();
    const b = await reserveUpload(actor, metadata, "idempotency-key-1");
    mocks.fetch.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(processUpload(actor, b.uploadId, b.nonce)).rejects.toThrow(
      "storage_unavailable",
    );
    mocks.fetch.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(processUpload(actor, b.uploadId, b.nonce)).rejects.toThrow(
      "object_not_uploaded",
    );
    expect((await uploadStatus(actor, b.uploadId)).state).toBe("pending");
  });
  it("commits new/duplicate outcomes with parser writes; replay reads no blob even after pending cleanup", async () => {
    const { actor } = await setup();
    mocks.fetch.mockImplementation(
      (_url: unknown, options: { method: string }) =>
        Promise.resolve(
          new Response(options.method === "GET" ? bytes.slice() : null),
        ),
    );
    const b = await reserveUpload(actor, metadata, "idempotency-key-1");
    const result = await processUpload(actor, b.uploadId, b.nonce);
    expect(result).toMatchObject({ state: "completed", duplicate: false });
    expect(await db.select().from(gameParticipants)).toHaveLength(10);
    await db.delete(pendingUploads).where(eq(pendingUploads.id, b.uploadId));
    mocks.fetch.mockClear();
    expect(await processUpload(actor, b.uploadId, b.nonce)).toEqual(result);
    expect(mocks.fetch).not.toHaveBeenCalled();
    const duplicate = await reserveUpload(actor, metadata, "idempotency-key-2");
    expect(
      await processUpload(actor, duplicate.uploadId, duplicate.nonce),
    ).toMatchObject({
      state: "duplicate",
      duplicate: true,
      gameId: result.gameId,
    });
    expect(await db.select().from(games)).toHaveLength(1);
  });
  it("finalizer failure rolls back new game and reports unknown, then status retains claim", async () => {
    const { actor } = await setup();
    const b = await reserveUpload(actor, metadata, "idempotency-key-1");
    mocks.fetch.mockImplementation(
      (_url: unknown, options: { method: string }) =>
        Promise.resolve(
          new Response(options.method === "GET" ? bytes.slice() : null),
        ),
    );
    await client.exec(
      "ALTER TABLE desktop_upload_jobs ADD CONSTRAINT fail_complete CHECK (state <> 'completed')",
    );
    try {
      await expect(processUpload(actor, b.uploadId, b.nonce)).rejects.toThrow(
        "outcome_unknown",
      );
      expect(await db.select().from(games)).toHaveLength(0);
      expect(await db.select().from(gameParticipants)).toHaveLength(0);
    } finally {
      await client.exec(
        "ALTER TABLE desktop_upload_jobs DROP CONSTRAINT fail_complete",
      );
    }
    await db
      .update(desktopUploadJobs)
      .set({ claimExpiresAt: new Date(0) })
      .where(eq(desktopUploadJobs.id, b.uploadId));
    expect((await uploadStatus(actor, b.uploadId)).state).toBe(
      "outcome_unknown",
    );
    mocks.fetch.mockClear();
    await processUpload(actor, b.uploadId, b.nonce);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("expired claims cannot finalize either duplicate or new ingestion", async () => {
    const { actor } = await setup();
    const b = await reserveUpload(actor, metadata, "idempotency-key-1");
    const claim = crypto.randomUUID();
    await db
      .update(desktopUploadJobs)
      .set({ state: "processing", claimId: claim, claimExpiresAt: new Date(0) })
      .where(eq(desktopUploadJobs.id, b.uploadId));
    await expect(
      ingestReplay({
        bytes,
        blobUrl:
          "https://teststore.private.blob.vercel-storage.com/replays/fixture.rofl",
        originalFilename: metadata.filename,
        lastModified: metadata.lastModified,
        actor,
        desktop: ingestionFinalizer(actor, b.uploadId, b.nonce, claim),
      }),
    ).rejects.toThrow("outcome_unknown");
    expect(await db.select().from(games)).toHaveLength(0);
  });
});
describe("HTTP boundary", () => {
  it("never accepts cookies as desktop authentication and returns stable private errors", async () => {
    const response = await sessionRoute(
      new Request("https://example.invalid/api/desktop/v1/session", {
        headers: { cookie: "llvy_session=anything" },
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_token", retryable: false },
    });
  });
  it("bounds JSON and rejects tokens before reading protected bodies", async () => {
    const oversized = new Request("https://example.invalid", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "a".repeat(9000) }),
    });
    expect((await endpoint(() => body(oversized))).status).toBe(413);
    const r = await reserveRoute(
      new Request("https://example.invalid", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "invalid",
      }),
    );
    expect(r.status).toBe(401);
    await expect(
      device(
        new Request("https://example.invalid", {
          headers: { authorization: "Bearer refresh." + state },
        }),
      ),
    ).rejects.toThrow();
  });
});
