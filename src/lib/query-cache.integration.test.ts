import { createHash, randomUUID } from "node:crypto";
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
  authAccounts,
  authSessions,
  gameParticipants,
  games,
  members,
  riotAccounts,
} from "@/db/schema";
import {
  client as postgres,
  db,
  migrateTestDatabase,
  resetTestDatabase,
} from "@/test/database";
import { replayBytes } from "@/test/replay";
import { ownerActor } from "@/test/actor";
import { createRedisProxy } from "@/test/redis-proxy";

const mocks = vi.hoisted(() => ({ token: undefined as string | undefined }));
function businessSelectCount(calls: unknown[][]) {
  return calls.filter(
    ([fields]) =>
      !(
        fields &&
        typeof fields === "object" &&
        "account" in fields &&
        fields.account === authAccounts
      ),
  ).length;
}
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => ({ db: (await import("@/test/database")).db }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: mocks.token }) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

import { createTestSession } from "@/test/auth";
import { revokeAdministrator } from "./account-administration";
import { withActorTransaction } from "./audit";
import { ingestReplay } from "./ingest";
import {
  setGameComment,
  setGameExcluded,
  setGamePlayedAt,
} from "./game-mutations";
import {
  createMember,
  deleteMember,
  linkAccount,
  unlinkAccount,
  updateMember,
} from "./member-mutations";
import {
  autocompleteSearch,
  resolveSearchMember,
  autocompleteStoredNicknames,
  normalizeNicknameSearch,
  resolveNicknameMember,
  searchStoredNicknames,
} from "./nickname-search";
import {
  normalizeNicknamePrefix,
  queryNicknameAutocomplete,
} from "./nickname-autocomplete";
import { cachedQuery, invalidateQueryCache } from "./query-cache";
import {
  getGameDetailReadModel,
  getGameListReadModel,
  getMemberHistoryReadModel,
  getMembersReadModel,
} from "./read-model";
import { disconnectRedis, getRedisConnection } from "./redis";
import type Redis from "ioredis";
import { createAutocompleteIndex } from "./autocomplete-index";
import {
  memberIndexKey,
  projectSearchSuggestion,
  type MemberSuggestion,
} from "./search-contract";

// Explicit opt-in: never derive this endpoint from the production REDIS_URL.
const testUrl = process.env.LLVY_REDIS_TEST_URL;
describe.skipIf(!testUrl)(
  "Podman Redis 7 query cache and nickname foundation",
  () => {
    let redis: Redis;
    let prefix: string;
    let versionChecked = false;

    beforeAll(async () => {
      const url = new URL(testUrl!);
      if (url.protocol !== "redis:" || url.hostname !== "127.0.0.1")
        throw new Error(
          "LLVY_REDIS_TEST_URL must target a disposable local container.",
        );
      await migrateTestDatabase();
    }, 30_000);
    beforeEach(async () => {
      disconnectRedis();
      await resetTestDatabase();
      vi.stubEnv("REDIS_URL", testUrl!);
      vi.stubEnv("REDIS_KEY_PREFIX", `llvy-test:${randomUUID()}`);
      vi.stubEnv(
        "POSTGRES_URL",
        "postgres://fixture:fixture@fixture.invalid/disposable",
      );
      vi.stubEnv("AUTH_SECRET", "independent-cache-signing-secret-32-bytes");
      mocks.token = (await createTestSession("owner")).token;
      const connection = await getRedisConnection();
      expect(connection).not.toBeNull();
      redis = connection!.client;
      prefix = connection!.prefix;
      if (!versionChecked) {
        expect(await redis.info("server")).toMatch(/^redis_version:7\./m);
        versionChecked = true;
      }
    });
    afterEach(async () => {
      vi.restoreAllMocks();
      // A disconnected ioredis socket can still briefly report status=ready.
      // Reconnect explicitly rather than relying on that transitional status.
      disconnectRedis();
      vi.stubEnv("REDIS_URL", testUrl!);
      redis = (await getRedisConnection())!.client;
      // Remove this test's UUID namespace only; never FLUSHDB/FLUSHALL.
      if (redis.status === "ready") {
        const keys = await redis.keys(`${prefix}:*`);
        if (keys.length) await redis.del(...keys);
      }
      disconnectRedis();
      vi.unstubAllEnvs();
    });
    afterAll(() => postgres.close());

    async function keys() {
      return redis.keys(`${prefix}:*`);
    }
    async function dataKeys() {
      return (await keys()).filter((key) => !key.endsWith(":generation"));
    }

    it.each(["readiness", "command"])(
      "falls back promptly when real Redis %s replies stop",
      async (phase) => {
        const proxy = await createRedisProxy(testUrl!);
        vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          disconnectRedis();
          vi.stubEnv("REDIS_URL", proxy.url);
          if (phase === "command") {
            const ready = await getRedisConnection();
            expect(ready).not.toBeNull();
            expect(await ready!.client.ping()).toBe("PONG");
          }
          proxy.stall();
          const load = vi.fn().mockResolvedValue("database result");
          const started = performance.now();
          expect(
            await cachedQuery({ query: "stalled", role: "viewer" }, load),
          ).toBe("database result");
          // Leaves scheduling headroom while rejecting the old 1-second stall.
          expect(performance.now() - started).toBeLessThan(750);
          expect(load).toHaveBeenCalledOnce();
          expect(await getRedisConnection()).toBeNull();
        } finally {
          disconnectRedis();
          await proxy.close();
        }
      },
    );
    async function seed(
      gameName = "우리 Player",
      excluded = false,
      tagLine = "KR1",
    ) {
      const [member] = await db
        .insert(members)
        .values({ name: "김모임원", birthYear: 1990 })
        .returning();
      const [account] = await db
        .insert(riotAccounts)
        .values({ memberId: member.id, puuid: randomUUID(), gameName, tagLine })
        .returning();
      const [game] = await db
        .insert(games)
        .values({
          fileHash: randomUUID(),
          blobUrl: `https://fixture.invalid/${randomUUID()}.rofl`,
          playedAt: "2026-10-01",
          playedAtSource: "file_mtime",
          excludedAt: excluded ? new Date() : null,
        })
        .returning();
      await db.insert(gameParticipants).values({
        gameId: game.id,
        riotAccountId: account.id,
        team: 100,
        champion: "Ahri",
      });
      return { member, account, game };
    }

    it("uses separate minimal member and account indices with warm reuse, expiry and partial-eviction recovery", async () => {
      const fixture = await seed("김계정");
      const expected = [
        {
          kind: "member",
          id: fixture.member.id,
          name: "김모임원",
          accounts: [{ gameName: "김계정", tagLine: "KR1" }],
        },
        {
          kind: "riot-account",
          id: fixture.account.id,
          gameName: "김계정",
          tagLine: "KR1",
        },
      ];
      expect(await autocompleteSearch("김")).toEqual(expected);
      const generation = await redis.get(`${prefix}:generation`);
      const memberKey = `${prefix}:${generation}:member-autocomplete:v1`;
      const accountKey = `${prefix}:${generation}:autocomplete:v1`;
      for (const key of [memberKey, accountKey]) {
        for (const suffix of ["names", "accounts", "ready"])
          expect(await redis.ttl(`${key}:${suffix}`)).toBeGreaterThanOrEqual(
            58,
          );
      }
      const stored = await redis.hgetall(`${memberKey}:accounts`);
      expect(Object.values(stored).map((value) => JSON.parse(value))).toEqual([
        expected[0],
      ]);
      const select = vi.spyOn(db, "select");
      expect(await autocompleteSearch("김")).toEqual(expected);
      expect(businessSelectCount(select.mock.calls)).toBe(0);
      const field = Object.keys(stored)[0];
      await redis.hset(
        `${memberKey}:accounts`,
        field,
        JSON.stringify({
          ...expected[0],
          birthYear: 1990,
          discordUserId: "secret",
        }),
      );
      expect(await autocompleteSearch("김")).toEqual(expected);
      await redis.hset(`${memberKey}:accounts`, field, "broken JSON");
      expect(await autocompleteSearch("김")).toEqual(expected);
      await redis.del(`${memberKey}:names`);
      expect(await autocompleteSearch("김")).toEqual(expected);
      await redis.pexpire(`${memberKey}:ready`, 1);
      await new Promise((resolve) => setTimeout(resolve, 10));
      select.mockClear();
      expect(await autocompleteSearch("김")).toEqual(expected);
      expect(businessSelectCount(select.mock.calls)).toBe(1);
      disconnectRedis();
      vi.stubEnv("REDIS_URL", "");
      expect(await autocompleteSearch("김")).toEqual(expected);
    });

    it("invalidates member names and previews only after committed member/account/game mutations", async () => {
      const fixture = await seed("김계정");
      await autocompleteSearch("김");
      const added = await createMember("김신규", 1995);
      expect((await autocompleteSearch("김신규"))[0]).toMatchObject({
        id: added,
        accounts: [],
      });
      await updateMember(added, "이변경", 1995);
      expect(await autocompleteSearch("김신규")).toEqual([]);
      expect((await autocompleteSearch("이변경"))[0].id).toBe(added);
      await linkAccount(fixture.account.id, added);
      expect((await autocompleteSearch("김모임원"))[0]).toMatchObject({
        accounts: [],
      });
      expect((await autocompleteSearch("이변경"))[0]).toMatchObject({
        accounts: [{ gameName: "김계정", tagLine: "KR1" }],
      });
      await withActorTransaction(ownerActor, async (tx) => {
        const { eq } = await import("drizzle-orm");
        await tx
          .update(riotAccounts)
          .set({ gameName: "새계정" })
          .where(eq(riotAccounts.id, fixture.account.id));
        return true;
      });
      expect((await autocompleteSearch("이변경"))[0]).toMatchObject({
        accounts: [{ gameName: "새계정", tagLine: "KR1" }],
      });
      await setGameExcluded(fixture.game.id, true);
      expect(await autocompleteSearch("새계정")).toEqual([]);
      expect((await autocompleteSearch("이변경"))[0].id).toBe(added);
      await setGameExcluded(fixture.game.id, false);
      expect((await autocompleteSearch("새계정"))[0]).toMatchObject({
        kind: "riot-account",
      });
      await unlinkAccount(fixture.account.id);
      expect((await autocompleteSearch("이변경"))[0]).toMatchObject({
        accounts: [],
      });
      const generation = await redis.get(`${prefix}:generation`);
      await expect(
        withActorTransaction(ownerActor, async (tx) => {
          await tx.insert(members).values({ name: "롤백모임원" });
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect(await redis.get(`${prefix}:generation`)).toBe(generation);
      expect(await autocompleteSearch("롤백")).toEqual([]);
      await deleteMember(added);
      expect(await autocompleteSearch("이변경")).toEqual([]);
      expect((await getMemberHistoryReadModel(added)).history).toBeNull();
    });

    it("does not trust warmed name suggestions for final resolution or revoked credentials", async () => {
      const fixture = await seed("김계정");
      await getMemberHistoryReadModel(fixture.member.id);
      const ownerToken = mocks.token;
      const admin = await createTestSession("admin");
      mocks.token = admin.token;
      await autocompleteSearch("김");
      const { eq } = await import("drizzle-orm");
      await db
        .update(members)
        .set({ name: "현재이름" })
        .where(eq(members.id, fixture.member.id));
      expect((await autocompleteSearch("김모임원"))[0]).toMatchObject({
        name: "김모임원",
      });
      expect(
        await resolveSearchMember({ mode: "unified", input: "김모임원" }),
      ).toEqual({ kind: "missing" });
      expect(
        await resolveSearchMember({ mode: "unified", input: "현재이름" }),
      ).toEqual({ kind: "member", memberId: fixture.member.id });
      mocks.token = ownerToken;
      expect(
        (await getMemberHistoryReadModel(fixture.member.id)).history?.member
          .name,
      ).toBe("현재이름");
      await db.delete(members).where(eq(members.id, fixture.member.id));
      expect(
        (await getMemberHistoryReadModel(fixture.member.id)).history,
      ).toBeNull();
      await revokeAdministrator(admin.accountId);
      mocks.token = admin.token;
      await expect(autocompleteSearch("김")).rejects.toThrow("Unauthorized");
      const viewer = await createTestSession("viewer");
      mocks.token = viewer.token;
      await autocompleteSearch("현재");
      await db
        .delete(authSessions)
        .where(eq(authSessions.id, viewer.sessionId));
      await expect(autocompleteSearch("현재")).rejects.toThrow("Unauthorized");
    });

    it("coalesces member builds and publishes a late snapshot only into its captured generation", async () => {
      const query = createAutocompleteIndex<MemberSuggestion>({
        namespace: "member-autocomplete:v1",
        indexedName: memberIndexKey,
        project(value) {
          const safe = projectSearchSuggestion(value);
          return safe?.kind === "member" ? safe : null;
        },
      });
      let finish!: (members: MemberSuggestion[]) => void;
      let started!: () => void;
      const began = new Promise<void>((resolve) => {
        started = resolve;
      });
      const pending = new Promise<MemberSuggestion[]>((resolve) => {
        finish = resolve;
      });
      const load = vi.fn(() => {
        started();
        return pending;
      });
      const first = query("김", load);
      await began;
      const second = query("김옛", load);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(
        (await keys()).some((key) => key.includes(":member-autocomplete:")),
      ).toBe(false);
      const generation = await redis.get(`${prefix}:generation`);
      await invalidateQueryCache();
      finish([
        { kind: "member", id: randomUUID(), name: "김옛이름", accounts: [] },
      ]);
      expect((await first)[0].name).toBe("김옛이름");
      expect((await second)[0].name).toBe("김옛이름");
      expect(load).toHaveBeenCalledOnce();
      expect(
        await redis.exists(
          `${prefix}:${generation}:member-autocomplete:v1:ready`,
        ),
      ).toBe(1);
      const current = vi
        .fn()
        .mockResolvedValue([
          { kind: "member", id: randomUUID(), name: "김현재", accounts: [] },
        ]);
      expect((await query("김", current))[0].name).toBe("김현재");
      expect((await query("김", current))[0].name).toBe("김현재");
      expect(current).toHaveBeenCalledOnce();
    });

    it("returns the same mixed candidates after a Redis command failure", async () => {
      await seed("김계정");
      const expected = await autocompleteSearch("김");
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(redis, "eval").mockRejectedValueOnce(
        new Error("fixture cache failure"),
      );
      expect(await autocompleteSearch("김")).toEqual(expected);
    });

    it("stores hits including null and expires entries with a real TTL", async () => {
      const load = vi.fn().mockResolvedValue(null);
      const identity = { query: "nullable", role: "viewer" as const };
      expect(await cachedQuery(identity, load)).toBeNull();
      expect(await cachedQuery(identity, load)).toBeNull();
      expect(load).toHaveBeenCalledTimes(1);
      const [key] = await dataKeys();
      expect(await redis.ttl(key)).toBeGreaterThanOrEqual(58);
      expect(await redis.ttl(key)).toBeLessThanOrEqual(60);
      await redis.pexpire(key, 1);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await cachedQuery(identity, load);
      expect(load).toHaveBeenCalledTimes(2);
    });

    it("separates roles and arguments and replaces corrupt entries", async () => {
      const load = vi.fn().mockResolvedValue({ safe: "value" });
      await cachedQuery({ query: "test", role: "viewer", args: [1] }, load);
      await cachedQuery({ query: "test", role: "owner", args: [1] }, load);
      await cachedQuery({ query: "test", role: "viewer", args: [2] }, load);
      expect(load).toHaveBeenCalledTimes(3);
      const key = (await dataKeys()).find((key) =>
        key.includes(":owner:test:"),
      )!;
      await redis.set(key, "invalid JSON");
      await cachedQuery({ query: "test", role: "owner", args: [1] }, load);
      expect(load).toHaveBeenCalledTimes(4);
      expect(JSON.parse((await redis.get(key))!).version).toBe(1);
    });

    it("never caches DB errors or repeats a failing loader", async () => {
      const load = vi.fn().mockRejectedValue(new Error("database failure"));
      await expect(
        cachedQuery({ query: "broken", role: "viewer" }, load),
      ).rejects.toThrow("database failure");
      expect(load).toHaveBeenCalledTimes(1);
      expect(await dataKeys()).toEqual([]);
    });

    it("bypasses large payloads instead of filling Redis", async () => {
      const load = vi.fn().mockResolvedValue("x".repeat(256 * 1024));
      const identity = { query: "large", role: "viewer" as const };
      await cachedQuery(identity, load);
      await cachedQuery(identity, load);
      expect(load).toHaveBeenCalledTimes(2);
      expect(await dataKeys()).toEqual([]);
    });

    it("returns a DB result once when a cache read fails", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(redis, "get").mockRejectedValueOnce(new Error("fixture-secret"));
      const load = vi.fn().mockResolvedValue("fresh DB result");
      expect(
        await cachedQuery({ query: "failure", role: "viewer" }, load),
      ).toBe("fresh DB result");
      expect(load).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain("fixture-secret");
    });

    it("isolates old game lists, caches minimal rosters, and refreshes member identities after mutations", async () => {
      const { member, account } = await seed();
      await cachedQuery(
        { query: "game-list", role: "owner", args: [10, 1, "active"] },
        async () => ({ legacy: true }),
      );
      const read = () => getGameListReadModel(10, undefined);
      const initial = await read();
      expect(initial.games[0].participants[0]).toMatchObject({
        memberId: member.id,
        memberName: member.name,
      });
      const query = vi.spyOn(postgres, "query");
      try {
        expect(await read()).toEqual(initial);
        expect(
          query.mock.calls.some(([sql]) => sql.includes('"game_participants"')),
        ).toBe(false);
      } finally {
        query.mockRestore();
      }
      const key = (await dataKeys()).find((key) =>
        key.includes(":game-list-v2:"),
      )!;
      const stored = (await redis.get(key))!;
      expect(stored).not.toMatch(/birthYear|birth_year|puuid|rawStats|blobUrl/);
      expect(await redis.ttl(key)).toBeGreaterThanOrEqual(58);
      await updateMember(member.id, "이변경", 1990);
      expect((await read()).games[0].participants[0].memberName).toBe("이변경");
      await unlinkAccount(account.id);
      expect((await read()).games[0].participants[0]).toMatchObject({
        memberId: null,
        memberName: null,
        gameName: account.gameName,
        tagLine: account.tagLine,
      });
      await linkAccount(account.id, member.id);
      expect((await read()).games[0].participants[0].memberName).toBe("이변경");
      await deleteMember(member.id);
      expect((await read()).games[0].participants[0]).toMatchObject({
        memberId: null,
        memberName: null,
      });
      mocks.token = undefined;
      await expect(read()).rejects.toThrow("redirect:/login");
    });

    it("isolates old member history and reuses enriched rosters without participant reads", async () => {
      const { member } = await seed();
      await db.update(gameParticipants).set({
        rawStats: { LEVEL: "17", ITEM0: "3158", PUUID: "private-roster" },
      });
      await cachedQuery(
        { query: "member-history", role: "owner", args: [member.id, 25, 0] },
        async () => ({ legacy: true }),
      );
      const initial = await getMemberHistoryReadModel(member.id);
      expect(initial.history?.games[0]).toMatchObject({
        level: 17,
        items: [3158, null, null, null, null, null, null],
      });
      expect(initial.history?.games[0].participants).toHaveLength(1);
      const query = vi.spyOn(postgres, "query");
      try {
        expect(await getMemberHistoryReadModel(member.id)).toEqual(initial);
        expect(
          query.mock.calls.some(([sql]) => sql.includes('"game_participants"')),
        ).toBe(false);
      } finally {
        query.mockRestore();
      }
      const key = (await dataKeys()).find((key) =>
        key.includes(":member-history-v2:"),
      )!;
      const stored = (await redis.get(key))!;
      expect(stored).not.toMatch(/rawStats|PUUID|private-roster/);
      expect(await redis.ttl(key)).toBeGreaterThanOrEqual(58);
    });

    it("isolates old detail cache entries and reuses projected item slots without raw stats", async () => {
      const { game } = await seed();
      await db.update(gameParticipants).set({
        rawStats: {
          ITEM0: "3158",
          ITEM1: "0",
          ITEM6: "3340",
          PUUID: "private-fixture",
        },
      });
      await cachedQuery(
        { query: "game-detail", role: "owner", args: [game.id] },
        async () => ({ legacy: true }),
      );
      const detail = await getGameDetailReadModel(game.id);
      expect(detail.game?.participants[0].items).toEqual([
        3158,
        0,
        null,
        null,
        null,
        null,
        3340,
      ]);
      expect(detail.game?.participants[0]).not.toHaveProperty("rawStats");
      const selects = vi.spyOn(db, "select");
      expect(await getGameDetailReadModel(game.id)).toEqual(detail);
      expect(businessSelectCount(selects.mock.calls)).toBe(0);
      expect(JSON.stringify(detail)).not.toContain("private-fixture");
    });

    it("keeps a committed mutation successful when cache invalidation fails", async () => {
      const { game } = await seed();
      await getGameDetailReadModel(game.id);
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(redis, "set").mockRejectedValueOnce(
        new Error("invalidation unavailable"),
      );
      await expect(setGameComment(game.id, "DB 커밋 유지")).resolves.toBe(true);
      expect((await db.select().from(games))[0].comment).toBe("DB 커밋 유지");
    });

    it("keeps a slow pre-mutation fill out of the new generation", async () => {
      let started!: () => void;
      let finish!: (value: string) => void;
      const began = new Promise<void>((resolve) => {
        started = resolve;
      });
      const waiting = new Promise<string>((resolve) => {
        finish = resolve;
      });
      const identity = { query: "race", role: "viewer" as const };
      const oldRead = cachedQuery(identity, () => {
        started();
        return waiting;
      });
      await began;
      await invalidateQueryCache();
      finish("old");
      expect(await oldRead).toBe("old");
      expect(await cachedQuery(identity, async () => "new")).toBe("new");
      expect(await cachedQuery(identity, async () => "wrong")).toBe("new");
    });

    it("regenerates an evicted generation without resurrecting old entries", async () => {
      const identity = { query: "eviction", role: "viewer" as const };
      await cachedQuery(identity, async () => "old");
      const previous = await redis.get(`${prefix}:generation`);
      await redis.del(`${prefix}:generation`);
      expect(await cachedQuery(identity, async () => "new")).toBe("new");
      expect(await redis.get(`${prefix}:generation`)).not.toBe(previous);
    });

    it("projects viewer data before caching while retaining live session checks", async () => {
      const { member, game } = await seed();
      await getMembersReadModel();
      mocks.token = (await createTestSession("viewer")).token;
      const read = await getMembersReadModel();
      const history = await getMemberHistoryReadModel(member.id);
      const detail = await getGameDetailReadModel(game.id);
      expect(read.members[0].name).toBe(member.name);
      expect(read.members[0]).not.toHaveProperty("birthYear");
      expect(history.history?.member.name).toBe(member.name);
      expect(history.history?.member).not.toHaveProperty("birthYear");
      expect(detail.game?.participants[0].memberName).toBe(member.name);
      expect(await getMembersReadModel()).toEqual(read);
      for (const key of (await dataKeys()).filter((key) =>
        key.includes(":viewer:"),
      )) {
        const stored = (await redis.get(key))!;
        expect(stored).toContain(member.name);
        expect(stored).not.toContain("김**원");
        expect(stored).not.toContain("birthYear");
      }
      mocks.token = undefined;
      const get = vi.spyOn(redis, "get");
      await expect(getMembersReadModel()).rejects.toThrow("redirect:/login");
      expect(get).not.toHaveBeenCalled();
    });

    it("ignores still-valid masked results from the previous cache namespace", async () => {
      const { member } = await seed();
      mocks.token = (await createTestSession("viewer")).token;
      const legacyPrefix = prefix.replace(/:v\d+$/, ":v1");
      const generation = randomUUID();
      const digest = createHash("sha256").update("[]").digest("hex");
      const generationKey = `${legacyPrefix}:generation`;
      const key = `${legacyPrefix}:${generation}:viewer:members:${digest}`;
      const stored = JSON.stringify({
        version: 1,
        expiresAt: Date.now() + 60_000,
        value: [{ id: member.id, name: "김**원", accounts: [] }],
      });
      try {
        await redis.set(generationKey, generation, "EX", 60);
        await redis.set(key, stored, "EX", 60);
        const read = await getMembersReadModel();
        expect(read.members[0].name).toBe(member.name);
        expect(read.members[0]).not.toHaveProperty("birthYear");
        expect(await getMembersReadModel()).toEqual(read);
        expect(await redis.get(key)).toBe(stored);
      } finally {
        await redis.del(generationKey, key);
      }
    });

    it("denies a revoked administrator before looking up warmed query data", async () => {
      await seed();
      const actor = await createTestSession("admin");
      mocks.token = actor.token;
      await getMembersReadModel();
      await autocompleteStoredNicknames("우리");
      mocks.token = (await createTestSession("owner")).token;
      await revokeAdministrator(actor.accountId);
      mocks.token = actor.token;
      const get = vi.spyOn(redis, "get");
      await expect(getMembersReadModel()).rejects.toThrow("redirect:/login");
      await expect(autocompleteStoredNicknames("우리")).rejects.toThrow();
      await expect(resolveNicknameMember("우리 Player#KR1")).rejects.toThrow();
      expect(get).not.toHaveBeenCalled();
    });

    it("invalidates member edits, links and deletion across cached read models", async () => {
      const { member, account, game } = await seed();
      await getMembersReadModel();
      await getGameDetailReadModel(game.id);
      await getMemberHistoryReadModel(member.id);
      await searchStoredNicknames("player");
      await updateMember(member.id, "이변경", 1995);
      expect((await getMembersReadModel()).members[0].name).toBe("이변경");
      expect(
        (await getGameDetailReadModel(game.id)).game?.participants[0]
          .memberName,
      ).toBe("이변경");
      expect(
        (await getMemberHistoryReadModel(member.id)).history?.member.name,
      ).toBe("이변경");
      expect((await searchStoredNicknames("player"))[0].memberName).toBe(
        "이변경",
      );
      await unlinkAccount(account.id);
      expect(await searchStoredNicknames("player")).toEqual([]);
      expect(
        (await getMemberHistoryReadModel(member.id)).history?.stats.totalGames,
      ).toBe(0);
      await linkAccount(account.id, member.id);
      expect(
        (await getMemberHistoryReadModel(member.id)).history?.stats.totalGames,
      ).toBe(1);
      await deleteMember(member.id);
      expect((await getMembersReadModel()).members).toEqual([]);
      expect(await searchStoredNicknames("player")).toEqual([]);
    });

    it("invalidates game comments, dates, exclusion and restores", async () => {
      const { game } = await seed();
      await getGameDetailReadModel(game.id);
      await getGameListReadModel(25, undefined);
      await setGameComment(game.id, "코멘트");
      expect((await getGameDetailReadModel(game.id)).game?.comment).toBe(
        "코멘트",
      );
      expect((await getGameListReadModel(25, undefined)).games[0].comment).toBe(
        "코멘트",
      );
      await setGamePlayedAt(game.id, "2026-10-03");
      expect(
        (await getGameListReadModel(25, undefined)).games[0].playedAt,
      ).toBe("2026-10-03");
      await searchStoredNicknames("player");
      await setGameExcluded(game.id, true);
      expect((await getGameListReadModel(25, undefined)).total).toBe(0);
      expect(await searchStoredNicknames("player")).toEqual([]);
      const detail = await getGameDetailReadModel(game.id);
      expect(typeof detail.game?.excludedAt).toBe("string");
      expect(await getGameDetailReadModel(game.id)).toEqual(detail);
      await setGameExcluded(game.id, false);
      expect(await searchStoredNicknames("player")).toHaveLength(1);
    });

    it("invalidates new replay ingestion and retains a duplicate's generation", async () => {
      expect((await getGameListReadModel(25, undefined)).total).toBe(0);
      const input = {
        bytes: replayBytes(),
        blobUrl: "https://fixture.invalid/replay.rofl",
        originalFilename: "fixture.rofl",
        lastModified: Date.now(),
        actor: ownerActor,
      };
      await ingestReplay(input);
      expect((await getGameListReadModel(25, undefined)).total).toBe(1);
      expect(await searchStoredNicknames("player1")).toEqual([]);
      const [imported] = await db.select().from(riotAccounts);
      const [member] = await db
        .insert(members)
        .values({ name: "업로드모임원" })
        .returning();
      await linkAccount(imported.id, member.id);
      expect(await searchStoredNicknames(imported.gameName)).toHaveLength(1);
      const generation = await redis.get(`${prefix}:generation`);
      expect((await ingestReplay(input)).duplicate).toBe(true);
      expect(await redis.get(`${prefix}:generation`)).toBe(generation);
    });

    it("does not invalidate a rolled-back transaction", async () => {
      await cachedQuery(
        { query: "rollback", role: "owner" },
        async () => "stable",
      );
      const generation = await redis.get(`${prefix}:generation`);
      await expect(
        withActorTransaction(ownerActor, async (tx) => {
          await tx.insert(members).values({ name: "rollback" });
          throw new Error("rollback fixture");
        }),
      ).rejects.toThrow("rollback fixture");
      expect(await redis.get(`${prefix}:generation`)).toBe(generation);
      expect(await db.select().from(members)).toEqual([]);
    });

    it("normalizes nickname and tag, escapes wildcards and caches equivalent searches", async () => {
      const fixture = await seed("우리 PLAYER");
      await seed("다른 PLAYER", false, "KR2");
      await seed("제외 PLAYER", true);
      const expected = [
        {
          id: fixture.account.id,
          gameName: "우리 PLAYER",
          tagLine: "KR1",
          memberId: fixture.member.id,
          memberName: "김모임원",
        },
      ];
      expect(await searchStoredNicknames(" player # kr1 ")).toEqual(expected);
      const firstKeys = await dataKeys();
      expect(await searchStoredNicknames("PLAYER#KR1")).toEqual(expected);
      expect(await dataKeys()).toEqual(firstKeys);
      expect((await dataKeys()).join()).not.toContain("player");
      for (const nickname of [
        "100%승리",
        "under_score",
        "back\\slash",
        "é선수",
      ]) {
        const item = await seed(nickname);
        const query = nickname === "é선수" ? "e\u0301선수" : nickname;
        expect((await searchStoredNicknames(query))[0].id).toBe(
          item.account.id,
        );
      }
      expect(await searchStoredNicknames("%없는계정")).toEqual([]);
      expect(await searchStoredNicknames("_없는계정")).toEqual([]);
      mocks.token = (await createTestSession("viewer")).token;
      expect((await searchStoredNicknames("player#kr1"))[0].memberName).toBe(
        "김모임원",
      );
      expect((await searchStoredNicknames("player#kr1"))[0]).not.toHaveProperty(
        "birthYear",
      );
    });

    it("bounds searches, rejects empty or malformed input and requires login", async () => {
      const fixture = await seed("cap00");
      const accounts = await db
        .insert(riotAccounts)
        .values(
          Array.from({ length: 22 }, (_, index) => ({
            puuid: randomUUID(),
            memberId: fixture.member.id,
            gameName: `cap${index + 1}`,
            tagLine: "KR1",
          })),
        )
        .returning();
      await db.insert(gameParticipants).values(
        accounts.map((account) => ({
          gameId: fixture.game.id,
          riotAccountId: account.id,
        })),
      );
      expect(await searchStoredNicknames("cap")).toHaveLength(20);
      for (const query of [
        "",
        " ",
        "#KR1",
        "player#",
        "player#KR1#extra",
        "a".repeat(101),
        "a\u0000",
      ]) {
        expect(normalizeNicknameSearch(query)).toBeNull();
        expect(await searchStoredNicknames(query)).toEqual([]);
      }
      mocks.token = undefined;
      await expect(searchStoredNicknames("cap")).rejects.toThrow();
    });

    it("returns DB results when no URL is configured and after an actual connection refusal", async () => {
      const fixture = await seed();
      disconnectRedis();
      vi.stubEnv("REDIS_URL", "");
      expect((await getMembersReadModel()).members[0].id).toBe(
        fixture.member.id,
      );
      vi.stubEnv("REDIS_URL", "redis://127.0.0.1:1");
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const started = performance.now();
      expect((await getMembersReadModel()).members[0].id).toBe(
        fixture.member.id,
      );
      expect(performance.now() - started).toBeLessThan(2000);
      await updateMember(fixture.member.id, "장애중수정", null);
      expect((await getMembersReadModel()).members[0].name).toBe("장애중수정");
    });

    it("uses the native lexicographic index for repeated normalized prefixes and stores no member data", async () => {
      const fixture = await seed("우리 Player");
      mocks.token = (await createTestSession("viewer")).token;
      expect(await autocompleteStoredNicknames("  우리 P ")).toEqual([
        { id: fixture.account.id, gameName: "우리 Player", tagLine: "KR1" },
      ]);
      const select = vi.spyOn(db, "select");
      expect(await autocompleteStoredNicknames("우리 player#k")).toHaveLength(
        1,
      );
      expect(await autocompleteStoredNicknames("우리 player#")).toHaveLength(1);
      expect(await autocompleteStoredNicknames("우리 player#jp")).toEqual([]);
      expect(await autocompleteStoredNicknames("player")).toEqual([]);
      expect(businessSelectCount(select.mock.calls)).toBe(0);
      expect(select).toHaveBeenCalledTimes(4); // Every cached read still checks DB authority.
      const indexKeys = (await keys()).filter((key) =>
        key.includes(":autocomplete:"),
      );
      expect(indexKeys).toHaveLength(3);
      for (const key of indexKeys) {
        expect(await redis.ttl(key)).toBeGreaterThanOrEqual(58);
        expect(await redis.ttl(key)).toBeLessThanOrEqual(60);
        if (key.endsWith(":accounts")) {
          const payload = JSON.stringify(await redis.hgetall(key));
          expect(payload).not.toContain("김모임원");
          expect(payload).not.toContain("birthYear");
          expect(payload).not.toContain("memberId");
        }
        if (key.endsWith(":names")) {
          expect(await redis.zrange(key, "0", "-1", "WITHSCORES")).toEqual([
            `우리 player#kr1\u0000${fixture.account.id}`,
            "0",
          ]);
        }
      }
      mocks.token = undefined;
      await expect(autocompleteStoredNicknames("우리")).rejects.toThrow();
      await expect(resolveNicknameMember("우리 Player")).rejects.toThrow();
    });

    it("handles NFC, emoji beyond BMP, literal wildcards, and a maximum of ten suggestions", async () => {
      await seed("Café😀");
      await seed("CafeZ");
      await seed("%literal_");
      for (let index = 0; index < 11; index++)
        await seed(`cap${index.toString().padStart(2, "0")}`);
      expect(
        (await autocompleteStoredNicknames("CAFE\u0301"))[0].gameName,
      ).toBe("Café😀");
      expect((await autocompleteStoredNicknames("café😀"))[0].gameName).toBe(
        "Café😀",
      );
      expect(await autocompleteStoredNicknames("cap")).toHaveLength(10);
      expect((await autocompleteStoredNicknames("%"))[0].gameName).toBe(
        "%literal_",
      );
      expect(await autocompleteStoredNicknames("_")).toEqual([]);
      for (const input of [
        "",
        " ",
        "#KR1",
        "a#b#c",
        "a".repeat(101),
        "a\u0000",
      ]) {
        expect(normalizeNicknamePrefix(input)).toBeNull();
        expect(await autocompleteStoredNicknames(input)).toEqual([]);
      }
      expect(normalizeNicknamePrefix(" Café # K ")).toBe("café#k");
    });

    it("excludes unlinked and excluded-only accounts in every search path, and refreshes after linking or restoration", async () => {
      const visible = await seed("visible");
      const excluded = await seed("excluded", true);
      await unlinkAccount(visible.account.id);
      expect(await autocompleteStoredNicknames("visible")).toEqual([]);
      expect(await searchStoredNicknames("visible")).toEqual([]);
      expect(await resolveNicknameMember("visible")).toEqual({
        kind: "missing",
      });
      expect(await autocompleteStoredNicknames("excluded")).toEqual([]);
      expect(await resolveNicknameMember("excluded")).toEqual({
        kind: "missing",
      });
      await linkAccount(visible.account.id, visible.member.id);
      expect(await autocompleteStoredNicknames("visible")).toHaveLength(1);
      await setGameExcluded(excluded.game.id, false);
      expect(await autocompleteStoredNicknames("excluded")).toHaveLength(1);
      await setGameExcluded(visible.game.id, true);
      expect(await autocompleteStoredNicknames("visible")).toEqual([]);
      await setGameExcluded(visible.game.id, false);
      expect(await autocompleteStoredNicknames("visible")).toHaveLength(1);
      await deleteMember(visible.member.id);
      expect(await autocompleteStoredNicknames("visible")).toEqual([]);
    });

    it("refreshes renamed accounts and new replay accounts after generation invalidation", async () => {
      const fixture = await seed("old nickname");
      expect(await autocompleteStoredNicknames("old")).toHaveLength(1);
      await withActorTransaction(ownerActor, async (tx) => {
        const { eq } = await import("drizzle-orm");
        await tx
          .update(riotAccounts)
          .set({ gameName: "new nickname", tagLine: "NEW" })
          .where(eq(riotAccounts.id, fixture.account.id));
        return true;
      });
      expect(await autocompleteStoredNicknames("old")).toEqual([]);
      expect(await autocompleteStoredNicknames("new#")).toEqual([]);
      expect(
        (await autocompleteStoredNicknames("new nickname#n"))[0].tagLine,
      ).toBe("NEW");
      const uploaded = await ingestReplay({
        bytes: replayBytes(),
        blobUrl: "https://fixture.invalid/autocomplete.rofl",
        actor: ownerActor,
        originalFilename: "autocomplete.rofl",
        lastModified: null,
      });
      expect(uploaded.duplicate).toBe(false);
      const rows = await db.select().from(riotAccounts);
      const imported = rows.find((row) => row.id !== fixture.account.id)!;
      expect(await autocompleteStoredNicknames(imported.gameName)).toEqual([]);
      await autocompleteSearch("김모임원");
      await linkAccount(imported.id, fixture.member.id);
      const memberSuggestion = (await autocompleteSearch("김모임원"))[0];
      expect(memberSuggestion.kind).toBe("member");
      if (memberSuggestion.kind === "member")
        expect(memberSuggestion.accounts).toContainEqual({
          gameName: imported.gameName,
          tagLine: imported.tagLine,
        });
      expect(
        (
          await autocompleteStoredNicknames(
            `${imported.gameName}#${imported.tagLine}`,
          )
        )[0].id,
      ).toBe(imported.id);
    });

    it("rebuilds an expired, evicted or malformed index and caches an empty snapshot", async () => {
      const fixture = await seed("rebuild");
      await autocompleteStoredNicknames("re");
      const marker = (await keys()).find((key) => key.endsWith(":ready"))!;
      const hash = marker.replace(/:ready$/, ":accounts");
      const name = `rebuild#kr1\u0000${fixture.account.id}`;
      await redis.hset(hash, name, "invalid JSON");
      expect(await autocompleteStoredNicknames("re")).toHaveLength(1);
      expect(JSON.parse((await redis.hget(hash, name))!).gameName).toBe(
        "rebuild",
      );
      await redis.del(hash);
      expect(await autocompleteStoredNicknames("re")).toHaveLength(1);
      await redis.pexpire(marker, 1);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const select = vi.spyOn(db, "select");
      await autocompleteStoredNicknames("re");
      expect(businessSelectCount(select.mock.calls)).toBe(1);
      await unlinkAccount(fixture.account.id);
      await autocompleteStoredNicknames("re");
      select.mockClear();
      expect(await autocompleteStoredNicknames("anything")).toEqual([]);
      expect(businessSelectCount(select.mock.calls)).toBe(0);
      expect(select).toHaveBeenCalledTimes(1);
    });

    it("coalesces concurrent index builds without exposing a partial snapshot", async () => {
      let started!: () => void;
      let finish!: (
        value: { id: string; gameName: string; tagLine: string }[],
      ) => void;
      const began = new Promise<void>((resolve) => {
        started = resolve;
      });
      const waiting = new Promise<
        { id: string; gameName: string; tagLine: string }[]
      >((resolve) => {
        finish = resolve;
      });
      const load = vi.fn(() => {
        started();
        return waiting;
      });
      const first = queryNicknameAutocomplete("a", load);
      await began;
      expect(
        (await keys()).filter((key) => key.includes(":autocomplete:")),
      ).toEqual([]);
      const second = queryNicknameAutocomplete("ab", load);
      // Let the second request reach the same in-flight build.
      await new Promise((resolve) => setTimeout(resolve, 20));
      finish([{ id: randomUUID(), gameName: "ABC", tagLine: "KR1" }]);
      expect(await first).toHaveLength(1);
      expect(await second).toHaveLength(1);
      expect(load).toHaveBeenCalledTimes(1);
      expect((await keys()).some((key) => key.includes(":building:"))).toBe(
        false,
      );
    });

    it("keeps a delayed index build in its captured generation", async () => {
      let started!: () => void;
      let finish!: (
        value: { id: string; gameName: string; tagLine: string }[],
      ) => void;
      const began = new Promise<void>((resolve) => {
        started = resolve;
      });
      const waiting = new Promise<
        { id: string; gameName: string; tagLine: string }[]
      >((resolve) => {
        finish = resolve;
      });
      const first = queryNicknameAutocomplete("a", () => {
        started();
        return waiting;
      });
      await began;
      const previous = await redis.get(`${prefix}:generation`);
      await invalidateQueryCache();
      finish([{ id: randomUUID(), gameName: "Ancient", tagLine: "KR1" }]);
      expect((await first)[0].gameName).toBe("Ancient");
      const load = vi
        .fn()
        .mockResolvedValue([
          { id: randomUUID(), gameName: "Actual", tagLine: "KR1" },
        ]);
      expect((await queryNicknameAutocomplete("a", load))[0].gameName).toBe(
        "Actual",
      );
      expect((await queryNicknameAutocomplete("a", load))[0].gameName).toBe(
        "Actual",
      );
      expect(load).toHaveBeenCalledTimes(1);
      expect(await redis.get(`${prefix}:generation`)).not.toBe(previous);
    });

    it("does not publish a half-built snapshot when a temporary key disappears", async () => {
      const fixture = { id: randomUUID(), gameName: "Atomic", tagLine: "KR1" };
      const original = redis.eval.bind(redis);
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(redis, "eval").mockImplementation(async (...args) => {
        if (args[1] === 5) await redis.del(String(args[2]));
        return original(...args);
      });
      const load = vi.fn().mockResolvedValue([fixture]);
      expect(await queryNicknameAutocomplete("a", load)).toEqual([fixture]);
      expect(load).toHaveBeenCalledTimes(1);
      vi.restoreAllMocks();
      disconnectRedis();
      redis = (await getRedisConnection())!.client;
      const indexKeys = (await keys()).filter((key) =>
        key.includes(":autocomplete:"),
      );
      expect(indexKeys.some((key) => key.endsWith(":ready"))).toBe(false);
      for (const key of indexKeys)
        expect(await redis.ttl(key)).toBeGreaterThan(0);
      expect(await queryNicknameAutocomplete("a", load)).toEqual([fixture]);
      expect(load).toHaveBeenCalledTimes(2);
    });

    it("propagates a failing DB build once even with an invalid generation", async () => {
      await redis.set(`${prefix}:generation`, "damaged");
      const load = vi.fn().mockRejectedValue(new Error("DB snapshot failed"));
      await expect(queryNicknameAutocomplete("a", load)).rejects.toThrow(
        "DB snapshot failed",
      );
      expect(load).toHaveBeenCalledTimes(1);
      await redis.del(`${prefix}:generation`);
      load.mockClear();
      await expect(queryNicknameAutocomplete("a", load)).rejects.toThrow(
        "DB snapshot failed",
      );
      expect(load).toHaveBeenCalledTimes(1);
    });

    it("returns the DB snapshot on an actual command failure and propagates DB errors only once", async () => {
      const fixture = await seed("fallback");
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(redis, "eval").mockRejectedValueOnce(
        new Error("fixture-secret"),
      );
      expect((await autocompleteStoredNicknames("fall"))[0].id).toBe(
        fixture.account.id,
      );
      const load = vi.fn().mockRejectedValue(new Error("DB unavailable"));
      await expect(queryNicknameAutocomplete("a", load)).rejects.toThrow(
        "DB unavailable",
      );
      expect(load).toHaveBeenCalledTimes(1);
      disconnectRedis();
      vi.stubEnv("REDIS_URL", "");
      expect((await autocompleteStoredNicknames("fall"))[0].id).toBe(
        fixture.account.id,
      );
      expect(await resolveNicknameMember("fallback")).toEqual({
        kind: "member",
        memberId: fixture.member.id,
      });
    });

    it("resolves exact normalized Riot IDs, offers safe ambiguous choices, and does not redirect partial names", async () => {
      const first = await seed("Café", false, "KR1");
      const second = await seed("Café", false, "KR2");
      mocks.token = (await createTestSession("viewer")).token;
      expect(await resolveNicknameMember("  CAFE\u0301 # kr1 ")).toEqual({
        kind: "member",
        memberId: first.member.id,
      });
      expect(await resolveNicknameMember("Café#kr2")).toEqual({
        kind: "member",
        memberId: second.member.id,
      });
      const result = await resolveNicknameMember("café");
      expect(result.kind).toBe("ambiguous");
      expect(JSON.stringify(result)).toContain("김모임원");
      expect(JSON.stringify(result)).not.toContain("birthYear");
      if (result.kind === "ambiguous")
        expect(
          result.members.every((member) => member.name === "김모임원"),
        ).toBe(true);
      for (const input of [
        "caf",
        "not-found",
        "Café#KR3",
        "",
        "Café#",
        "Café#KR1#extra",
      ]) {
        expect(await resolveNicknameMember(input)).toEqual({ kind: "missing" });
      }
    });

    it("resolves same-member duplicate nicknames once and checks current links despite a stale index", async () => {
      const first = await seed("same", false, "KR1");
      const second = await seed("same", false, "KR2");
      await linkAccount(second.account.id, first.member.id);
      expect(await resolveNicknameMember("same")).toEqual({
        kind: "member",
        memberId: first.member.id,
      });
      await autocompleteStoredNicknames("same");
      // Simulate a DB change whose Redis invalidation was lost.
      const { eq } = await import("drizzle-orm");
      await db
        .update(riotAccounts)
        .set({ memberId: null })
        .where(eq(riotAccounts.id, first.account.id));
      expect(await autocompleteStoredNicknames("same#kr1")).toHaveLength(1);
      expect(await resolveNicknameMember("same#kr1")).toEqual({
        kind: "missing",
      });
      await db.delete(members).where(eq(members.id, first.member.id));
      expect(await resolveNicknameMember("same")).toEqual({ kind: "missing" });
    });

    it("keeps autocomplete and submitted Unicode case normalization identical", async () => {
      for (const [name, tag] of [
        ["İstanbul", "İTR"],
        ["ΟΣ", "Σ"],
        ["Cafe\u0301", "KR1"],
      ]) {
        const fixture = await seed(name, false, tag);
        await invalidateQueryCache();
        const prefixInput = name.normalize("NFC").toLowerCase();
        const suggestions = await autocompleteStoredNicknames(prefixInput);
        expect(
          suggestions.some((account) => account.id === fixture.account.id),
        ).toBe(true);
        expect(await resolveNicknameMember(`${name}#${tag}`)).toEqual({
          kind: "member",
          memberId: fixture.member.id,
        });
        expect(
          await resolveNicknameMember(
            `${name.toLowerCase()}#${tag.toLowerCase()}`,
          ),
        ).toEqual({ kind: "member", memberId: fixture.member.id });
        expect((await searchStoredNicknames(name))[0].id).toBe(
          fixture.account.id,
        );
      }
    });
  },
);
