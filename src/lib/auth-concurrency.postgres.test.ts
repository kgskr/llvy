import { setTimeout as delay } from "node:timers/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
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
import * as schema from "@/db/schema";

const state = vi.hoisted(() => ({
  token: undefined as string | undefined,
  pool: undefined as import("pg").Pool | undefined,
  queries: [] as { query: string; params: unknown[] }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (state.token ? { value: state.token } : undefined),
  }),
}));
vi.mock("@/db", async () => {
  const connectionString = process.env.LLVY_POSTGRES_TEST_URL;
  if (!connectionString) return { db: undefined };
  // Explicit opt-in to a disposable local database; never use POSTGRES_URL.
  const url = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/llvy_auth_test" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "LLVY_POSTGRES_TEST_URL must target a disposable local llvy_auth_test database.",
    );
  }
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  state.pool = new Pool({
    connectionString,
    max: 6,
    application_name: "llvy-auth-regression",
    statement_timeout: 10_000,
    lock_timeout: 5_000,
  });
  return {
    db: drizzle(state.pool, {
      schema: await import("@/db/schema"),
      logger: {
        logQuery(query, params) {
          state.queries.push({ query, params });
        },
      },
    }),
  };
});
import { createSessionToken, randomReference } from "@/lib/auth";
import {
  completeDiscordLogin,
  hashReference,
  saveMembership,
  type MembershipCheck,
} from "@/lib/auth-store";
import { getSession, UnauthorizedError } from "@/lib/session";
import { resolveSearchMember } from "@/lib/nickname-search";
import { normalizeSearchText } from "@/lib/search-normalization";
import unicode from "@/lib/search-unicode-data.json";
import {
  AccountIneligibleError,
  grantAdministrator,
  revokeAdministrator,
  grantUploader,
  revokeUploader,
} from "@/lib/account-administration";
import { createLoginAttempt, consumeLoginAttempt } from "@/lib/oauth-attempts";

import { db } from "@/db";
import { bumpCacheRevisions, readCacheRevision } from "./cache-revisions";
import { createMember, deleteMember, linkAccount } from "./member-mutations";
import { setGameExcluded, setGamePlayedAt } from "./game-mutations";
import { ingestReplay } from "./ingest";
import { replayBytes, replayPlayer } from "@/test/replay";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  startAuthorization,
  approveAuthorization,
  exchangeAuthorization,
  refreshAuthorization,
  revokeOwnDevice,
} from "@/lib/desktop/auth-store";
import { credentialActor } from "@/lib/desktop/authority";
import {
  reserveUpload,
  sessionInfo,
  uploadStatus,
} from "@/lib/desktop/upload-store";
import { ingestionFinalizer } from "@/lib/desktop/process";
import { CLIENT_ID, pkce } from "@/lib/desktop/protocol";
import { cleanupExpiredAuthorizationRequests } from "@/lib/desktop/auth-request-cleanup";
import { consumeRequestBudgets } from "@/lib/request-budget";
import { createPendingUpload } from "@/lib/pending-upload-store";

const OWNER_USER = "111111111111111111";
const TARGET_USER = "444444444444444444";
const GUILD = "222222222222222222";
const FIRST = "10000000-0000-4000-8000-000000000001";
const SECOND = "20000000-0000-4000-8000-000000000002";
const BARRIER = 137918;

async function waitForLock(advisory: boolean) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const result = await state.pool!.query(
      `select 1 from pg_stat_activity where application_name = 'llvy-auth-regression'
       and wait_event_type = 'Lock' and (wait_event = 'advisory') = $1`,
      [advisory],
    );
    if (result.rowCount) return;
    await delay(10);
  }
  throw new Error("Expected concurrent operation to reach its database lock");
}

describe.skipIf(!process.env.LLVY_POSTGRES_TEST_URL)(
  "authentication concurrency and indexed search on PostgreSQL",
  () => {
    beforeAll(async () => {
      await migrate(drizzle(state.pool!, { schema }), {
        migrationsFolder: "drizzle",
      });
    }, 30_000);
    beforeEach(async () => {
      await state.pool!.query(
        "TRUNCATE desktop_auth_requests, auth_membership_decisions, audit_logs, admin_grants, auth_sessions, auth_accounts, pending_uploads, oauth_login_attempts, discord_api_controls, request_budgets, game_participants, games, riot_accounts, members CASCADE",
      );
      state.queries = [];
      vi.stubEnv("REDIS_URL", "");
      await state.pool!.query(
        "UPDATE cache_policy SET enabled = true; UPDATE cache_revisions SET revision = 0",
      );
      vi.stubEnv(
        "AUTH_SECRET",
        "isolated-postgres-test-secret-more-than-32-bytes",
      );
      vi.stubEnv("DISCORD_OWNER_USER_ID", OWNER_USER);
      vi.stubEnv("DISCORD_GUILD_ID", GUILD);
      vi.stubEnv("DISCORD_CLIENT_ID", "333333333333333333");
      vi.stubEnv("DISCORD_CLIENT_SECRET", "isolated-client-secret");
      vi.stubEnv("DISCORD_BOT_TOKEN", "isolated-bot-token");
      vi.stubEnv(
        "DISCORD_REDIRECT_URI",
        "http://localhost:3000/api/auth/discord/callback",
      );
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ code: 10007 }, { status: 404 })),
      );
    });
    afterEach(() => {
      state.token = undefined;
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });
    afterAll(async () => {
      await state.pool?.end();
    });

    async function loginCacheOwner() {
      state.token = (
        await completeDiscordLogin(
          { id: OWNER_USER, username: "owner", displayName: "owner" },
          {
            userId: OWNER_USER,
            guildId: GUILD,
            version: 1,
            status: "member",
            checkedAt: new Date(),
          },
        )
      ).token;
      return (await getSession())!;
    }

    async function loginTarget(userId = TARGET_USER) {
      const result = await completeDiscordLogin(
        { id: userId, username: "fixture", displayName: "Fixture" },
        {
          userId,
          guildId: GUILD,
          version: 1,
          status: "member",
          checkedAt: new Date(),
        },
      );
      state.token = result.token;
      return (await getSession())!;
    }
    function memberLookup() {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) =>
          Response.json({
            user: { id: String(url).split("/").at(-1) },
            pending: false,
          }),
        ),
      );
    }
    async function loginUploader() {
      const target = await loginTarget();
      await loginCacheOwner();
      memberLookup();
      await grantUploader(target.accountId);
      const ownerToken = state.token;
      state.token = target.token;
      const actor = (await getSession())!;
      state.token = ownerToken;
      return actor;
    }
    it("serializes concurrent uploader grants and admin promotion without active overlap", async () => {
      const target = await loginTarget();
      await loginCacheOwner();
      memberLookup();
      const outcomes = await Promise.allSettled([
        grantUploader(target.accountId),
        grantUploader(target.accountId),
      ]);
      expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      await revokeUploader(target.accountId);
      const transitions = await Promise.allSettled([
        grantUploader(target.accountId),
        grantAdministrator(target.accountId),
      ]);
      expect(transitions.some((r) => r.status === "fulfilled")).toBe(true);
      expect(
        (await db.select().from(schema.adminGrants)).filter(
          (g) => g.revokedAt === null,
        ),
      ).toHaveLength(1);
      expect(
        (await db.select().from(schema.uploaderGrants)).filter(
          (g) => g.revokedAt === null,
        ),
      ).toHaveLength(0);
    });
    it.each(["member", "absent", "pending"] as const)(
      "rejects a grant and its %s membership result when its admin issuer is revoked during the provider lookup",
      async (status) => {
        const target = await loginTarget("555555555555555555");
        const admin = await loginTarget();
        await loginCacheOwner();
        const ownerToken = state.token;
        memberLookup();
        await grantAdministrator(admin.accountId);
        let entered!: () => void, release!: () => void;
        const entry = new Promise<void>((r) => {
            entered = r;
          }),
          gate = new Promise<void>((r) => {
            release = r;
          });
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => {
            entered();
            await gate;
            return status === "absent"
              ? Response.json({ code: 10007 }, { status: 404 })
              : Response.json({
                  user: { id: target.discordUserId },
                  pending: status === "pending",
                });
          }),
        );
        state.token = admin.token;
        const granting = grantUploader(target.accountId);
        const outcome = Promise.allSettled([granting]);
        await entry;
        state.token = ownerToken;
        try {
          await revokeAdministrator(admin.accountId);
        } finally {
          release();
        }
        expect((await outcome)[0].status).toBe("rejected");
        expect(await db.select().from(schema.uploaderGrants)).toHaveLength(0);
        expect(
          (
            await db
              .select()
              .from(schema.authAccounts)
              .where(eq(schema.authAccounts.id, target.accountId))
          )[0].status,
        ).toBe("active");
        expect(
          (
            await db
              .select()
              .from(schema.authSessions)
              .where(eq(schema.authSessions.id, target.sessionId))
          )[0].revokedAt,
        ).toBeNull();
        expect(
          (await db.select().from(schema.auditLogs)).filter(
            (row) => row.action === "auth.account_suspended",
          ),
        ).toHaveLength(0);
      },
    );
    it.each(["absent", "pending"] as const)(
      "does not apply a delayed %s uploader-grant denial after the target becomes admin",
      async (status) => {
        const target = await loginTarget();
        await loginCacheOwner();
        let entered!: () => void;
        const entry = new Promise<void>((r) => {
          entered = r;
        });
        const blocker = await state.pool!.connect();
        try {
          await blocker.query("BEGIN");
          await blocker.query(
            "SELECT id FROM auth_accounts WHERE id = $1 FOR UPDATE",
            [target.accountId],
          );
          // Let promotion finish its provider lookup first, then queue at the
          // account lock. The bot permit serializes provider requests, so a
          // second lookup must not wait behind an artificially paused fetch.
          memberLookup();
          const promotion = Promise.allSettled([
            grantAdministrator(target.accountId),
          ]);
          await waitForLock(false);
          vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
              entered();
              return status === "absent"
                ? Response.json({ code: 10007 }, { status: 404 })
                : Response.json({
                    user: { id: target.discordUserId },
                    pending: true,
                  });
            }),
          );
          const outcome = Promise.allSettled([grantUploader(target.accountId)]);
          await entry;
          await blocker.query("COMMIT");
          expect((await promotion)[0].status).toBe("fulfilled");
          expect((await outcome)[0]).toMatchObject({
            status: "rejected",
            reason: expect.any(AccountIneligibleError),
          });
        } finally {
          await blocker.query("ROLLBACK");
          blocker.release();
        }
        expect(
          (
            await db
              .select()
              .from(schema.authAccounts)
              .where(eq(schema.authAccounts.id, target.accountId))
          )[0].status,
        ).toBe("active");
        expect(
          (await db.select().from(schema.adminGrants))[0].revokedAt,
        ).toBeNull();
        expect(
          (
            await db
              .select()
              .from(schema.authSessions)
              .where(eq(schema.authSessions.id, target.sessionId))
          )[0].revokedAt,
        ).toBeNull();
        expect(
          (await db.select().from(schema.auditLogs)).filter(
            (row) => row.action === "auth.account_suspended",
          ),
        ).toHaveLength(0);
      },
    );
    for (const transition of ["revoke", "promote", "leave"] as const) {
      it(`serializes uploader final commit before ${transition} and rejects the stale actor afterward`, async () => {
        const uploader = await loginUploader();
        const { actor } = await desktopDevice(uploader);
        const job = await claimed(actor, "uploader-concurrency-key");
        let entered!: () => void, release!: () => void;
        const entry = new Promise<void>((r) => {
            entered = r;
          }),
          gate = new Promise<void>((r) => {
            release = r;
          });
        const writing = ingestReplay({
          bytes: desktopBytes,
          blobUrl: "https://fixture.invalid/uploader-commit",
          originalFilename: desktopMetadata.filename,
          lastModified: null,
          actor,
          uploadId: job.binding.uploadId,
          desktop: {
            lock: job.hook.lock,
            finalize: async (tx, result, hash) => {
              await job.hook.finalize(tx, result, hash);
              entered();
              await gate;
            },
          },
        });
        const written = Promise.allSettled([writing]);
        await entry;
        const mutation =
          transition === "revoke"
            ? revokeUploader(uploader.accountId)
            : transition === "promote"
              ? grantAdministrator(uploader.accountId)
              : saveMembership({
                  userId: uploader.discordUserId,
                  guildId: GUILD,
                  status: "absent",
                  version: Date.now() + 1000,
                  checkedAt: new Date(),
                });
        const changed = Promise.allSettled([mutation]);
        try {
          await waitForLock(false);
        } finally {
          release();
        }
        expect((await written)[0].status).toBe("fulfilled");
        expect((await changed)[0].status).toBe("fulfilled");
        expect(await db.select().from(schema.games)).toHaveLength(1);
        await expect(
          ingestReplay({
            bytes: desktopBytes,
            blobUrl: "https://fixture.invalid/stale",
            originalFilename: "stale.rofl",
            lastModified: null,
            actor: uploader,
          }),
        ).rejects.toThrow();
        await expect(sessionInfo(actor)).rejects.toThrow();
        expect(
          (await db.select().from(schema.uploaderGrants)).every(
            (g) => g.revokedAt !== null,
          ),
        ).toBe(true);
      });
    }

    async function desktopApproval(
      actor: Awaited<ReturnType<typeof loginCacheOwner>>,
    ) {
      vi.stubEnv("DESKTOP_UPLOADER_ENABLED", "true");
      vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_fixture_test");
      const verifier = "v".repeat(43),
        redirectUri = "http://127.0.0.1:43123/callback";
      const request = await startAuthorization(
        {
          clientId: CLIENT_ID,
          redirectUri,
          state: randomReference(),
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
        code: new URL(callback!).searchParams.get("code"),
        codeVerifier: verifier,
      };
    }
    async function desktopDevice(
      actor: Awaited<ReturnType<typeof loginCacheOwner>>,
    ) {
      const tokens = await exchangeAuthorization(
        await desktopApproval(actor),
        crypto.randomUUID(),
      );
      return {
        tokens,
        actor: await credentialActor(tokens.accessToken, "access"),
      };
    }
    const desktopBytes = replayBytes();
    const desktopMetadata = {
      filename: "KR_123.rofl",
      size: desktopBytes.length,
      lastModified: Date.now(),
      clientSha256: createHash("sha256").update(desktopBytes).digest("hex"),
    };
    it("cleans disjoint expired batches while skipping an authorization row locked by another connection", async () => {
      const now = Date.now();
      const ids = Array.from({ length: 22 }, () => crypto.randomUUID());
      const data = {
        clientId: CLIENT_ID,
        redirectUri: "http://127.0.0.1:43123/callback",
        state: randomReference(),
        challenge: pkce("v".repeat(43)),
        mode: "transient",
      };
      await db.insert(schema.desktopAuthRequests).values(
        ids.map((id, i) => ({
          ...data,
          id,
          expiresAt: new Date(i === 21 ? now + 600000 : now - 10000 + i),
        })),
      );
      const blocker = await state.pool!.connect();
      try {
        await blocker.query("BEGIN");
        await blocker.query(
          "SELECT id FROM desktop_auth_requests WHERE id = $1 FOR UPDATE",
          [ids[0]],
        );
        expect(
          await Promise.all([
            cleanupExpiredAuthorizationRequests(10),
            cleanupExpiredAuthorizationRequests(10),
          ]),
        ).toEqual([10, 10]);
        expect(
          (await db.select().from(schema.desktopAuthRequests))
            .map((r) => r.id)
            .sort(),
        ).toEqual([ids[0], ids[21]].sort());
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
      vi.stubEnv("DESKTOP_UPLOADER_ENABLED", "true");
      const { challenge, ...start } = data;
      await startAuthorization(
        { ...start, codeChallenge: challenge, codeChallengeMethod: "S256" },
        "cleanup-ip",
      );
      const remaining = await db.select().from(schema.desktopAuthRequests);
      expect(remaining).toHaveLength(2);
      expect(remaining.some((r) => r.id === ids[21])).toBe(true);
      expect(remaining.every((r) => r.expiresAt.getTime() > now)).toBe(true);
    });
    it("consumes desktop authorization once across simultaneous exchanges", async () => {
      const actor = await loginCacheOwner();
      const body = await desktopApproval(actor);
      const outcomes = await Promise.allSettled([
        exchangeAuthorization(body, "ip-a"),
        exchangeAuthorization(body, "ip-b"),
      ]);
      expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await db.select().from(schema.desktopSessions)).toHaveLength(1);
    });
    it("commits refresh replay revocation under concurrent rotation", async () => {
      const { tokens, actor } = await desktopDevice(await loginCacheOwner());
      const outcomes = await Promise.allSettled([
        refreshAuthorization({ refreshToken: tokens.refreshToken }, "ip-a"),
        refreshAuthorization({ refreshToken: tokens.refreshToken }, "ip-b"),
      ]);
      expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      await expect(sessionInfo(actor)).rejects.toThrow();
      expect(
        (await db.select().from(schema.desktopSessions))[0].revokedAt,
      ).not.toBeNull();
    });
    it("serializes identical desktop reservation keys without a second budget debit", async () => {
      const { actor } = await desktopDevice(await loginCacheOwner());
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          reserveUpload(actor, desktopMetadata, "same-idempotency-key"),
        ),
      );
      expect(new Set(results.map((r) => r.uploadId)).size).toBe(1);
      expect(new Set(results.map((r) => r.nonce)).size).toBe(1);
      expect((await sessionInfo(actor)).quota.account.remaining).toBe(9);
    });
    it("shares the final account slot across devices and rolls back losing global debit", async () => {
      const owner = await loginCacheOwner();
      const a = await desktopDevice(owner),
        b = await desktopDevice(owner);
      for (let i = 0; i < 9; i++) await createPendingUpload("browser", owner);
      const results = await Promise.allSettled([
        reserveUpload(a.actor, desktopMetadata, "last-slot-key-one"),
        reserveUpload(b.actor, desktopMetadata, "last-slot-key-two"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((await sessionInfo(a.actor)).quota).toMatchObject({
        account: { remaining: 0 },
        global: { remaining: 40 },
      });
    });
    it("sorts opposite budget input order and rolls back later audit failures", async () => {
      const a = { key: "order-a", limit: 10, windowMs: 60000 },
        b = { key: "order-b", limit: 10, windowMs: 60000 };
      expect(
        await Promise.all([
          consumeRequestBudgets([a, b]),
          consumeRequestBudgets([b, a]),
        ]),
      ).toEqual([true, true]);
      const { actor } = await desktopDevice(await loginCacheOwner());
      await state.pool!.query(
        "ALTER TABLE audit_logs ADD CONSTRAINT reject_desktop_reserved CHECK (action <> 'replay.reserved')",
      );
      try {
        await expect(
          reserveUpload(actor, desktopMetadata, "rollback-budget-key"),
        ).rejects.toThrow();
        expect((await sessionInfo(actor)).quota.account.remaining).toBe(10);
        expect(await db.select().from(schema.desktopUploadJobs)).toHaveLength(
          0,
        );
      } finally {
        await state.pool!.query(
          "ALTER TABLE audit_logs DROP CONSTRAINT reject_desktop_reserved",
        );
      }
    });
    async function claimed(
      actor: Awaited<ReturnType<typeof credentialActor>>,
      key: string,
    ) {
      const binding = await reserveUpload(actor, desktopMetadata, key),
        claim = crypto.randomUUID();
      await db
        .update(schema.pendingUploads)
        .set({ state: "processing" })
        .where(eq(schema.pendingUploads.id, binding.uploadId));
      await db
        .update(schema.desktopUploadJobs)
        .set({
          state: "processing",
          claimId: claim,
          claimExpiresAt: new Date(Date.now() + 120000),
        })
        .where(eq(schema.desktopUploadJobs.id, binding.uploadId));
      return {
        binding,
        hook: ingestionFinalizer(actor, binding.uploadId, binding.nonce, claim),
      };
    }
    for (const failDuplicate of [false, true])
      it(`finalizes unique-race duplicate atomically (reject duplicate=${failDuplicate})`, async () => {
        const owner = await loginCacheOwner(),
          a = await desktopDevice(owner),
          b = await desktopDevice(owner);
        const jobs = await Promise.all([
          claimed(a.actor, "race-key-aaaaaaaa"),
          claimed(b.actor, "race-key-bbbbbbbb"),
        ]);
        const barrier = await state.pool!.connect();
        await barrier.query("SELECT pg_advisory_lock($1)", [BARRIER + 9]);
        await state.pool!.query(
          `CREATE FUNCTION pause_desktop_game() RETURNS trigger AS $$ BEGIN PERFORM pg_advisory_xact_lock_shared(${BARRIER + 9}); RETURN NEW; END; $$ LANGUAGE plpgsql; CREATE TRIGGER pause_desktop_game BEFORE INSERT ON games FOR EACH ROW EXECUTE FUNCTION pause_desktop_game()`,
        );
        const operations = jobs.map((j, i) =>
          ingestReplay({
            bytes: desktopBytes,
            blobUrl: "https://fixture.invalid/" + j.binding.uploadId,
            originalFilename: desktopMetadata.filename,
            lastModified: desktopMetadata.lastModified,
            actor: i === 0 ? a.actor : b.actor,
            desktop: {
              lock: j.hook.lock,
              finalize: async (tx, result, hash) => {
                await j.hook.finalize(tx, result, hash);
                if (failDuplicate && result.duplicate)
                  throw new Error("duplicate-finalizer-test");
              },
            },
          }),
        );
        const settled = Promise.allSettled(operations);
        try {
          let waiting = false;
          for (let i = 0; i < 150; i++) {
            const r = await state.pool!.query(
              "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='llvy-auth-regression' AND wait_event='advisory'",
            );
            if (r.rows[0].n >= 2) {
              waiting = true;
              break;
            }
            await delay(10);
          }
          expect(waiting).toBe(true);
        } finally {
          await barrier.query("SELECT pg_advisory_unlock($1)", [BARRIER + 9]);
          barrier.release();
        }
        const outcomes = await settled;
        await state.pool!.query(
          "DROP TRIGGER pause_desktop_game ON games; DROP FUNCTION pause_desktop_game()",
        );
        expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(
          failDuplicate ? 1 : 2,
        );
        expect(await db.select().from(schema.games)).toHaveLength(1);
        expect(await db.select().from(schema.gameParticipants)).toHaveLength(
          10,
        );
        const states = (await db.select().from(schema.desktopUploadJobs))
          .map((j) => j.state)
          .sort();
        expect(states).toEqual(
          failDuplicate
            ? ["completed", "processing"]
            : ["completed", "duplicate"],
        );
      });
    it("holds device authority through final commit while revocation waits", async () => {
      const owner = await loginCacheOwner(),
        { actor } = await desktopDevice(owner),
        job = await claimed(actor, "commit-revoke-key");
      let entered!: () => void, release!: () => void;
      const entry = new Promise<void>((r) => {
          entered = r;
        }),
        gate = new Promise<void>((r) => {
          release = r;
        });
      const writing = ingestReplay({
        bytes: desktopBytes,
        blobUrl: "https://fixture.invalid/locked",
        originalFilename: desktopMetadata.filename,
        lastModified: desktopMetadata.lastModified,
        actor,
        desktop: {
          lock: job.hook.lock,
          finalize: async (tx, result, hash) => {
            await job.hook.finalize(tx, result, hash);
            entered();
            await gate;
          },
        },
      });
      await entry;
      const revoking = revokeOwnDevice(owner, actor.deviceSessionId);
      try {
        await waitForLock(false);
      } finally {
        release();
      }
      await writing;
      await revoking;
      expect((await db.select().from(schema.desktopUploadJobs))[0].state).toBe(
        "completed",
      );
      expect(await db.select().from(schema.games)).toHaveLength(1);
      await expect(uploadStatus(actor, job.binding.uploadId)).rejects.toThrow();
    });

    it("keeps legacy conflict resolution atomic against concurrent PUUID promotion", async () => {
      const actor = await loginCacheOwner();
      const barrier = await state.pool!.connect();
      const writer = await state.pool!.connect();
      await writer.query("SET application_name = 'llvy-cache-race-fixture'");
      const writerPid = (await writer.query("SELECT pg_backend_pid() AS pid"))
        .rows[0].pid;
      await barrier.query("SELECT pg_advisory_lock($1), pg_advisory_lock($2)", [
        BARRIER,
        BARRIER + 1,
      ]);
      await state.pool!.query(`
        CREATE FUNCTION pause_legacy_insert() RETURNS trigger AS $$ BEGIN
          IF NEW.game_name = 'LegacyRace' AND NEW.puuid IS NULL AND current_setting('application_name') = 'llvy-auth-regression' THEN
            PERFORM set_config('llvy.cache_race', '1', true);
            PERFORM pg_advisory_xact_lock(${BARRIER});
          END IF; RETURN NEW;
        END; $$ LANGUAGE plpgsql;
        CREATE FUNCTION pause_legacy_statement() RETURNS trigger AS $$ BEGIN
          IF current_setting('llvy.cache_race', true) = '1' THEN
            PERFORM pg_advisory_xact_lock(${BARRIER + 1});
          END IF; RETURN NULL;
        END; $$ LANGUAGE plpgsql;
        CREATE TRIGGER pause_legacy_insert BEFORE INSERT ON riot_accounts FOR EACH ROW EXECUTE FUNCTION pause_legacy_insert();
        CREATE TRIGGER pause_legacy_statement AFTER INSERT ON riot_accounts FOR EACH STATEMENT EXECUTE FUNCTION pause_legacy_statement();
      `);
      const ingesting = ingestReplay({
        bytes: replayBytes({
          players: [
            replayPlayer({ RIOT_ID_GAME_NAME: "LegacyRace", PUUID: null }),
          ],
        }),
        actor,
        blobUrl: "https://fixture.invalid/legacy-race.rofl",
        originalFilename: "legacy-race.rofl",
        lastModified: Date.now(),
      });
      let promoting: Promise<unknown> | undefined;
      try {
        await waitForLock(true);
        const {
          rows: [legacy],
        } = await writer.query(
          "INSERT INTO riot_accounts(game_name, tag_line) VALUES ('LegacyRace', 'KR1') RETURNING id",
        );
        const before = await readCacheRevision(["accounts"]);
        await barrier.query("SELECT pg_advisory_unlock($1)", [BARRIER]);
        // The second barrier is entered after the conflict statement has run.
        await expect
          .poll(
            async () =>
              (
                await state.pool!.query(
                  "SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted AND objid=$1",
                  [BARRIER + 1],
                )
              ).rows[0].n,
          )
          .toBe(1);
        promoting = writer.query(
          "UPDATE riot_accounts SET puuid = 'race-puuid' WHERE id = $1 AND puuid IS NULL",
          [legacy.id],
        );
        await expect
          .poll(
            async () =>
              (
                await state.pool!.query(
                  "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
                  [writerPid],
                )
              ).rows[0].wait_event_type,
          )
          .toBe("Lock");
        await barrier.query("SELECT pg_advisory_unlock($1)", [BARRIER + 1]);
        const saved = await ingesting;
        await promoting;
        expect(await readCacheRevision(["accounts"])).toEqual(before);
        const participant = (
          await state.pool!.query(
            "SELECT riot_account_id FROM game_participants WHERE game_id=$1",
            [saved.gameId],
          )
        ).rows[0];
        expect(participant.riot_account_id).toBe(legacy.id);
        expect(
          (
            await state.pool!.query(
              "SELECT puuid FROM riot_accounts WHERE id=$1",
              [legacy.id],
            )
          ).rows[0].puuid,
        ).toBe("race-puuid");
      } finally {
        await barrier.query("SELECT pg_advisory_unlock_all()");
        await Promise.allSettled([ingesting, promoting]);
        await writer.query("SET application_name = 'llvy-auth-regression'");
        writer.release();
        barrier.release();
        await state.pool!.query(
          "DROP TRIGGER pause_legacy_insert ON riot_accounts; DROP TRIGGER pause_legacy_statement ON riot_accounts; DROP FUNCTION pause_legacy_insert(); DROP FUNCTION pause_legacy_statement();",
        );
      }
    }, 20000);

    it("rolls back business data and an already bumped revision atomically", async () => {
      await loginCacheOwner();
      const memberId = await createMember("변경 전", null);
      const before = await readCacheRevision(["members"]);
      await expect(
        db.transaction(async (tx) => {
          await tx
            .update(schema.members)
            .set({ name: "롤백" })
            .where(eq(schema.members.id, memberId));
          await bumpCacheRevisions(tx, ["members", "members"]);
          throw new Error("forced rollback");
        }),
      ).rejects.toThrow("forced rollback");
      expect(await readCacheRevision(["members"])).toEqual(before);
      expect(
        (
          await state.pool!.query("SELECT name FROM members WHERE id = $1", [
            memberId,
          ])
        ).rows[0].name,
      ).toBe("변경 전");
    });

    it("serializes overlapping member, game and ingest writers after business locks without losing revisions", async () => {
      const actor = await loginCacheOwner();
      const input = {
        bytes: replayBytes(),
        blobUrl: "https://fixture.invalid/cache.rofl",
        originalFilename: "cache.rofl",
        lastModified: Date.now(),
        actor,
      };
      const game = await ingestReplay(input);
      const memberId = await createMember("동시 변경", null);
      const accountId = (
        await state.pool!.query(
          "SELECT id FROM riot_accounts ORDER BY id LIMIT 1",
        )
      ).rows[0].id;
      await linkAccount(accountId, memberId);
      const before = await readCacheRevision([
        "accounts",
        "history",
        "game-list",
      ]);
      const barrier = await state.pool!.connect();
      await barrier.query("SELECT pg_advisory_lock($1)", [BARRIER]);
      await state.pool!.query(`
        CREATE FUNCTION pause_cache_revision() RETURNS trigger AS $$
        BEGIN PERFORM pg_advisory_xact_lock(${BARRIER}); RETURN NEW; END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER pause_cache_revision BEFORE INSERT OR UPDATE ON cache_revisions
        FOR EACH ROW EXECUTE FUNCTION pause_cache_revision();
      `);
      let tasks: Promise<unknown>[] = [];
      try {
        const removal = deleteMember(memberId);
        tasks = [removal];
        await waitForLock(true);
        tasks.push(
          linkAccount(accountId, memberId),
          setGameExcluded(game.gameId, true),
          ingestReplay({
            ...input,
            bytes: replayBytes({ metadata: { gameLength: 2000000 } }),
          }),
        );
        await waitForLock(false);
        await barrier.query("SELECT pg_advisory_unlock($1)", [BARRIER]);
        const results = await Promise.allSettled(tasks);
        expect(results.every((result) => result.status === "fulfilled")).toBe(
          true,
        );
        expect(results[1]).toMatchObject({ status: "fulfilled", value: false });
        const after = await readCacheRevision([
          "accounts",
          "history",
          "game-list",
        ]);
        expect(
          BigInt(after!.values.accounts) - BigInt(before!.values.accounts),
        ).toBe(BigInt(1));
        expect(
          BigInt(after!.values.history) - BigInt(before!.values.history),
        ).toBe(BigInt(3));
        expect(
          BigInt(after!.values["game-list"]) -
            BigInt(before!.values["game-list"]),
        ).toBe(BigInt(2));
        await Promise.all([
          setGamePlayedAt(game.gameId, "2026-10-01"),
          setGameExcluded(game.gameId, false),
        ]);
      } finally {
        await barrier.query("SELECT pg_advisory_unlock($1)", [BARRIER]);
        await Promise.allSettled(tasks);
        barrier.release();
        await state.pool!.query(
          "DROP TRIGGER pause_cache_revision ON cache_revisions; DROP FUNCTION pause_cache_revision();",
        );
      }
    }, 20000);

    it.each([
      ["absent", true],
      ["absent", false],
      ["pending", true],
      ["pending", false],
    ] as const)(
      "serializes first registration with newer %s (denial commits first: %s)",
      async (status, denialFirst) => {
        const identity = {
          id: TARGET_USER,
          username: "new-user",
          displayName: "새 사용자",
        };
        const eligible: MembershipCheck = {
          userId: TARGET_USER,
          guildId: GUILD,
          version: 10,
          status: "member",
          checkedAt: new Date(),
        };
        const denied = { ...eligible, version: 20, status };
        await state.pool!.query(`
          CREATE FUNCTION pause_membership_decision() RETURNS trigger AS $$
          BEGIN
            IF NEW.version = ${denialFirst ? 20 : 10} THEN
              PERFORM pg_advisory_xact_lock(${BARRIER});
            END IF;
            RETURN NEW;
          END; $$ LANGUAGE plpgsql;
          CREATE TRIGGER pause_membership_decision AFTER INSERT OR UPDATE
          ON auth_membership_decisions FOR EACH ROW
          EXECUTE FUNCTION pause_membership_decision();
        `);
        const barrier = await state.pool!.connect();
        const operations: Promise<unknown>[] = [];
        try {
          await barrier.query("select pg_advisory_lock($1)", [BARRIER]);
          const login = () =>
            completeDiscordLogin(identity, eligible).catch(
              (error: unknown) => error,
            );
          const deny = () => saveMembership(denied);
          const first = denialFirst ? deny() : login();
          operations.push(first);
          await waitForLock(true);
          const second = denialFirst ? login() : deny();
          operations.push(second);
          await waitForLock(false);
          await barrier.query("select pg_advisory_unlock($1)", [BARRIER]);
          const results = await Promise.all([first, second]);
          if (denialFirst) {
            expect(results[1]).toBeInstanceOf(UnauthorizedError);
            expect(
              (await state.pool!.query("select id from auth_accounts")).rows,
            ).toHaveLength(0);
          } else {
            expect(results[0]).toMatchObject({ role: "viewer" });
            expect(results[1]).toBe(true);
            expect(
              (await state.pool!.query("select status from auth_accounts"))
                .rows[0].status,
            ).toBe("suspended");
          }
          expect(
            (
              await state.pool!.query(
                "select id from auth_sessions where revoked_at is null",
              )
            ).rows,
          ).toHaveLength(0);
          await expect(
            completeDiscordLogin(identity, eligible),
          ).rejects.toThrow(UnauthorizedError);
          const fresh = { ...eligible, version: 30 };
          state.token = (await completeDiscordLogin(identity, fresh)).token;
          expect(await saveMembership(denied)).toBe(false);
          await expect(completeDiscordLogin(identity, fresh)).rejects.toThrow(
            UnauthorizedError,
          );
          expect(await getSession()).toMatchObject({
            discordUserId: TARGET_USER,
            role: "viewer",
          });
        } finally {
          await barrier.query("select pg_advisory_unlock($1)", [BARRIER]);
          barrier.release();
          await Promise.allSettled(operations);
          await state.pool!.query(
            "DROP TRIGGER pause_membership_decision ON auth_membership_decisions; DROP FUNCTION pause_membership_decision();",
          );
        }
      },
    );

    it("uses selective indexes for exact searches across 10,000 members and accounts", async () => {
      state.token = (
        await completeDiscordLogin(
          { id: OWNER_USER, username: "owner", displayName: "owner" },
          {
            userId: OWNER_USER,
            guildId: GUILD,
            version: 1,
            status: "member",
            checkedAt: new Date(),
          },
        )
      ).token;
      // Direct SQL is only fixture setup; exercise production search afterward.
      await state.pool!.query(`
        INSERT INTO members(id, name)
        SELECT md5(i::text)::uuid, CASE WHEN i=1 THEN 'QueryTarget' ELSE 'Member-' || i END
        FROM generate_series(1,10000) AS i;
        INSERT INTO riot_accounts(member_id,game_name,tag_line,puuid)
        SELECT md5(i::text)::uuid, CASE WHEN i<=2 THEN 'QueryTarget' ELSE 'Account-' || i END,
          'KR1', i::text FROM generate_series(1,10000) AS i;
        INSERT INTO riot_accounts(member_id,game_name,tag_line,puuid)
        SELECT md5('2')::uuid,'QueryTarget','KR1','extra-' || i FROM generate_series(1,25) AS i;
        INSERT INTO games(id,file_hash,blob_url,played_at,played_at_source)
        VALUES ('${FIRST}','search-fixture','https://example.invalid/fixture','2026-10-10','file_mtime');
        INSERT INTO game_participants(game_id,riot_account_id)
        SELECT '${FIRST}',id FROM riot_accounts;
        ANALYZE members; ANALYZE riot_accounts; ANALYZE games; ANALYZE game_participants;
      `);
      for (const input of [
        { mode: "unified", input: "QUERYTARGET" },
        { mode: "nickname", input: "QueryTarget#kr1" },
      ] as const) {
        state.queries = [];
        const result = await resolveSearchMember(input);
        expect(result).toMatchObject({
          kind: "ambiguous",
          total: 2,
          pageCount: 1,
        });
        if (result.kind !== "ambiguous")
          throw new Error("Expected member choices");
        expect(result.members).toHaveLength(2);
        expect(
          result.members.every((member) => member.accounts.length <= 2),
        ).toBe(true);
        const queries = state.queries.filter(({ query }) =>
          query.includes('"matching_members"'),
        );
        expect(queries).toHaveLength(2);
        for (const { query, params } of queries) {
          const explanation = await state.pool!.query(
            "EXPLAIN (ANALYZE, FORMAT JSON) " + query,
            params,
          );
          const plan = explanation.rows[0]["QUERY PLAN"][0].Plan;
          const nodes: Record<string, unknown>[] = [];
          function visit(node: Record<string, unknown>) {
            nodes.push(node);
            for (const child of (node.Plans ?? []) as Record<string, unknown>[])
              visit(child);
          }
          visit(plan);
          expect(nodes.map((node) => node["Index Name"])).toContain(
            "riot_accounts_normalized_name_idx",
          );
          if (input.mode === "unified")
            expect(nodes.map((node) => node["Index Name"])).toContain(
              "members_normalized_name_idx",
            );
          expect(
            nodes.filter(
              (node) =>
                node["Node Type"] === "Seq Scan" &&
                ["members", "riot_accounts"].includes(
                  String(node["Relation Name"]),
                ),
            ),
          ).toHaveLength(0);
          expect(plan["Actual Rows"]).toBeLessThanOrEqual(40);
        }
      }
    }, 30_000);

    it("preserves canonical Unicode composition and combining order on PostgreSQL 17", async () => {
      const inputs = [" İSTANBUL ", "ΟΣ", "ΟΣΑ", "😀가", "\uFEFFMixed\uFEFF"];
      // All canonical decompositions include modern scripts absent from PG 17's
      // Unicode tables, plus every Hangul syllable and older composition pair.
      for (let cp = 1; cp <= 0x10ffff; cp++) {
        if (cp >= 0xd800 && cp <= 0xdfff) continue;
        const value = String.fromCodePoint(cp);
        const decomposed = value.normalize("NFD");
        if (value !== decomposed) inputs.push(decomposed);
      }
      for (const [composed, decomposed] of Object.entries(
        unicode.nfcCompatibility.decompositions,
      )) {
        inputs.push(composed, decomposed, "A" + decomposed + "\u0301");
      }
      // Old/new marks in both orders, with starters and leading non-starters.
      for (const mark of Object.keys(unicode.nfcCompatibility.classes)) {
        inputs.push(
          "A" + mark + "\u{1E5EE}",
          "A\u{1E5EE}" + mark,
          mark + "\u{1E5EE}\u0323",
          "\u{1E5EE}" + mark + "\u0301",
        );
      }
      for (let start = 0; start < inputs.length; start += 500) {
        const batch = inputs.slice(start, start + 500);
        if (process.versions.unicode === unicode.unicode) {
          expect(batch.map(normalizeSearchText)).toEqual(
            batch.map((value) => value.normalize("NFC").trim().toLowerCase()),
          );
        }
        const { rows } = await state.pool!.query(
          "select llvy_normalize_search_v1(value) as normalized from unnest($1::text[]) with ordinality as source(value, ordinal) order by ordinal",
          [batch],
        );
        expect(rows.map((row) => row.normalized)).toEqual(
          batch.map(normalizeSearchText),
        );
      }
    }, 30_000);

    it.each([true, false])(
      "serializes grant-time denial with revocation (owner sorts first: %s)",
      async (ownerFirst) => {
        const owner = ownerFirst ? FIRST : SECOND;
        const target = ownerFirst ? SECOND : FIRST;
        await state.pool!.query(
          `insert into auth_accounts (id, discord_user_id, username, display_name, guild_id, membership_checked_at)
       values ($1,$2,'owner','owner',$5,now()), ($3,$4,'target','target',$5,now())`,
          [owner, OWNER_USER, target, TARGET_USER, GUILD],
        );
        const reference = randomReference();
        state.token = await createSessionToken(reference);
        await state.pool!.query(
          `insert into auth_sessions (account_id, reference_hash, guild_id, expires_at)
       values ($1,$2,$3,now()+interval '1 day'), ($4,'target-session',$3,now()+interval '1 day')`,
          [owner, hashReference(reference), GUILD, target],
        );
        await state.pool!.query(
          "insert into admin_grants (account_id, issued_by) values ($1,$2)",
          [target, owner],
        );
        // Pause actual suspension after its account SELECT locks and before the
        // revoked_by FK lookup. The competing service can now acquire its locks.
        await state.pool!.query(`
      CREATE FUNCTION pause_auth_suspension() RETURNS trigger AS $$
      BEGIN
        IF NEW.status = 'suspended' THEN PERFORM pg_advisory_xact_lock(${BARRIER}); END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER pause_auth_suspension BEFORE UPDATE ON auth_accounts
      FOR EACH ROW EXECUTE FUNCTION pause_auth_suspension();
    `);
        const barrier = await state.pool!.connect();
        const operations: Promise<unknown>[] = [];
        try {
          await barrier.query("select pg_advisory_lock($1)", [BARRIER]);
          const denial = grantAdministrator(target).catch(
            (error: unknown) => error,
          );
          operations.push(denial);
          await waitForLock(true);
          const revocation = revokeAdministrator(target).catch(
            (error: unknown) => error,
          );
          operations.push(revocation);
          await waitForLock(false);
          await barrier.query("select pg_advisory_unlock($1)", [BARRIER]);
          expect(await denial).toBeInstanceOf(AccountIneligibleError);
          expect(await revocation).toBe(false); // suspension already retired the grant
          expect(
            (
              await state.pool!.query(
                "select status from auth_accounts where id=$1",
                [target],
              )
            ).rows[0].status,
          ).toBe("suspended");
          expect(
            (
              await state.pool!.query(
                "select count(*)::int as n from auth_sessions where account_id=$1 and revoked_at is null",
                [target],
              )
            ).rows[0].n,
          ).toBe(0);
          expect(
            (
              await state.pool!.query(
                "select revoked_by, revoked_at from admin_grants",
              )
            ).rows[0],
          ).toMatchObject({ revoked_by: owner, revoked_at: expect.any(Date) });
        } finally {
          await barrier.query("select pg_advisory_unlock($1)", [BARRIER]);
          barrier.release();
          await Promise.allSettled(operations);
          await state.pool!.query(
            "DROP TRIGGER pause_auth_suspension ON auth_accounts; DROP FUNCTION pause_auth_suspension();",
          );
        }
      },
    );

    it("reclaims expired attempts without waiting on locked rows or deleting a live callback", async () => {
      const live = await createLoginAttempt("/games");
      for (let i = 0; i < 40; i++) {
        await state.pool!.query(
          "insert into oauth_login_attempts(state_hash,binding_hash,redirect_to,expires_at) values ($1,$2,'/',now()-interval '1 day')",
          [hashReference("state-" + i), hashReference("binding-" + i)],
        );
      }
      const blocker = await state.pool!.connect();
      let starts: Promise<unknown> | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query(
          "select state_hash from oauth_login_attempts where expires_at <= now() order by expires_at, state_hash limit 20 for update",
        );
        starts = Promise.all([
          createLoginAttempt("/"),
          createLoginAttempt("/"),
        ]);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            starts,
            new Promise((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(new Error("login start waited on expired row locks")),
                1500,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
        expect(
          (
            await state.pool!.query(
              "select count(*)::int as n from oauth_login_attempts where expires_at <= now()",
            )
          ).rows[0].n,
        ).toBe(20);
        expect(
          await consumeLoginAttempt(
            new URL(live.url).searchParams.get("state"),
            live.binding,
          ),
        ).toEqual({ redirectTo: "/games" });
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        await starts;
      }
      await createLoginAttempt("/");
      expect(
        (
          await state.pool!.query(
            "select count(*)::int as n from oauth_login_attempts where expires_at <= now()",
          )
        ).rows[0].n,
      ).toBe(0);
    });
  },
);
