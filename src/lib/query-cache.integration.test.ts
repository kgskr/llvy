import { randomUUID } from "node:crypto";
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
import { gameParticipants, games, members, riotAccounts } from "@/db/schema";
import {
  client as postgres,
  db,
  migrateTestDatabase,
  resetTestDatabase,
} from "@/test/database";
import { replayBytes } from "@/test/replay";
import { ownerActor } from "@/test/actor";

const mocks = vi.hoisted(() => ({ token: undefined as string | undefined }));
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

import { createSessionToken } from "./auth";
import {
  authenticateAccessKey,
  grantAdminCredential,
  revokeAdminCredential,
} from "./admin-credentials";
import { withActorTransaction } from "./audit";
import { ingestReplay } from "./ingest";
import {
  setGameComment,
  setGameExcluded,
  setGamePlayedAt,
} from "./game-mutations";
import {
  deleteMember,
  linkAccount,
  unlinkAccount,
  updateMember,
} from "./member-mutations";
import {
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
import { disconnectValkey, getValkeyConnection } from "./valkey";
import type Redis from "ioredis";

// Explicit opt-in: never derive this endpoint from the production VALKEY_URL.
const testUrl = process.env.LLVY_VALKEY_TEST_URL;
describe.skipIf(!testUrl)(
  "Podman Valkey 9 query cache and nickname foundation",
  () => {
    let valkey: Redis;
    let prefix: string;
    let versionChecked = false;

    beforeAll(async () => {
      const url = new URL(testUrl!);
      if (url.protocol !== "redis:" || url.hostname !== "127.0.0.1")
        throw new Error(
          "LLVY_VALKEY_TEST_URL must target a disposable local container.",
        );
      await migrateTestDatabase();
    }, 30_000);
    beforeEach(async () => {
      disconnectValkey();
      await resetTestDatabase();
      vi.stubEnv("VALKEY_URL", testUrl!);
      vi.stubEnv("VALKEY_KEY_PREFIX", `llvy-test:${randomUUID()}`);
      vi.stubEnv(
        "POSTGRES_URL",
        "postgres://fixture:fixture@fixture.invalid/disposable",
      );
      vi.stubEnv("READ_PASSWORD", "cache-viewer-fixture");
      vi.stubEnv("OWNER_PASSWORD", "cache-owner-fixture");
      vi.stubEnv("AUTH_SECRET", "independent-cache-signing-secret-32-bytes");
      mocks.token = await createSessionToken("owner");
      const connection = await getValkeyConnection();
      expect(connection).not.toBeNull();
      valkey = connection!.client;
      prefix = connection!.prefix;
      if (!versionChecked) {
        expect(await valkey.info("server")).toMatch(/^valkey_version:9\./m);
        versionChecked = true;
      }
    });
    afterEach(async () => {
      vi.restoreAllMocks();
      // A disconnected ioredis socket can still briefly report status=ready.
      // Reconnect explicitly rather than relying on that transitional status.
      disconnectValkey();
      vi.stubEnv("VALKEY_URL", testUrl!);
      valkey = (await getValkeyConnection())!.client;
      // Remove this test's UUID namespace only; never FLUSHDB/FLUSHALL.
      if (valkey.status === "ready") {
        const keys = await valkey.keys(`${prefix}:*`);
        if (keys.length) await valkey.del(...keys);
      }
      disconnectValkey();
      vi.unstubAllEnvs();
    });
    afterAll(() => postgres.close());

    async function keys() {
      return valkey.keys(`${prefix}:*`);
    }
    async function dataKeys() {
      return (await keys()).filter((key) => !key.endsWith(":generation"));
    }
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

    it("stores hits including null and expires entries with a real TTL", async () => {
      const load = vi.fn().mockResolvedValue(null);
      const identity = { query: "nullable", role: "viewer" as const };
      expect(await cachedQuery(identity, load)).toBeNull();
      expect(await cachedQuery(identity, load)).toBeNull();
      expect(load).toHaveBeenCalledTimes(1);
      const [key] = await dataKeys();
      expect(await valkey.ttl(key)).toBeGreaterThanOrEqual(58);
      expect(await valkey.ttl(key)).toBeLessThanOrEqual(60);
      await valkey.pexpire(key, 1);
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
      await valkey.set(key, "invalid JSON");
      await cachedQuery({ query: "test", role: "owner", args: [1] }, load);
      expect(load).toHaveBeenCalledTimes(4);
      expect(JSON.parse((await valkey.get(key))!).version).toBe(1);
    });

    it("never caches DB errors or repeats a failing loader", async () => {
      const load = vi.fn().mockRejectedValue(new Error("database failure"));
      await expect(
        cachedQuery({ query: "broken", role: "viewer" }, load),
      ).rejects.toThrow("database failure");
      expect(load).toHaveBeenCalledTimes(1);
      expect(await dataKeys()).toEqual([]);
    });

    it("bypasses large payloads instead of filling Valkey", async () => {
      const load = vi.fn().mockResolvedValue("x".repeat(256 * 1024));
      const identity = { query: "large", role: "viewer" as const };
      await cachedQuery(identity, load);
      await cachedQuery(identity, load);
      expect(load).toHaveBeenCalledTimes(2);
      expect(await dataKeys()).toEqual([]);
    });

    it("returns a DB result once when a cache read fails", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(valkey, "get").mockRejectedValueOnce(
        new Error("fixture-secret"),
      );
      const load = vi.fn().mockResolvedValue("fresh DB result");
      expect(
        await cachedQuery({ query: "failure", role: "viewer" }, load),
      ).toBe("fresh DB result");
      expect(load).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain("fixture-secret");
    });

    it("keeps a committed mutation successful when cache invalidation fails", async () => {
      const { game } = await seed();
      await getGameDetailReadModel(game.id);
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(valkey, "set").mockRejectedValueOnce(
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
      const previous = await valkey.get(`${prefix}:generation`);
      await valkey.del(`${prefix}:generation`);
      expect(await cachedQuery(identity, async () => "new")).toBe("new");
      expect(await valkey.get(`${prefix}:generation`)).not.toBe(previous);
    });

    it("projects viewer data before caching while retaining live session checks", async () => {
      const { member, game } = await seed();
      await getMembersReadModel();
      mocks.token = await createSessionToken("viewer");
      const read = await getMembersReadModel();
      const history = await getMemberHistoryReadModel(member.id);
      const detail = await getGameDetailReadModel(game.id);
      expect(read.members[0].name).toBe("김**원");
      expect(history.history?.member).not.toHaveProperty("birthYear");
      expect(detail.game?.participants[0].memberName).toBe("김**원");
      for (const key of (await dataKeys()).filter((key) =>
        key.includes(":viewer:"),
      )) {
        const stored = (await valkey.get(key))!;
        expect(stored).not.toContain("김모임원");
        expect(stored).not.toContain("birthYear");
      }
      mocks.token = undefined;
      const get = vi.spyOn(valkey, "get");
      await expect(getMembersReadModel()).rejects.toThrow("redirect:/login");
      expect(get).not.toHaveBeenCalled();
    });

    it("denies a revoked administrator before looking up warmed query data", async () => {
      const { member } = await seed();
      const grant = await grantAdminCredential(member.id);
      const actor = (await authenticateAccessKey(grant.key))!;
      mocks.token = await createSessionToken(actor);
      await getMembersReadModel();
      await autocompleteStoredNicknames("우리");
      mocks.token = await createSessionToken("owner");
      await revokeAdminCredential(member.id);
      mocks.token = await createSessionToken(actor);
      const get = vi.spyOn(valkey, "get");
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
      const generation = await valkey.get(`${prefix}:generation`);
      expect((await ingestReplay(input)).duplicate).toBe(true);
      expect(await valkey.get(`${prefix}:generation`)).toBe(generation);
    });

    it("does not invalidate a rolled-back transaction", async () => {
      await cachedQuery(
        { query: "rollback", role: "owner" },
        async () => "stable",
      );
      const generation = await valkey.get(`${prefix}:generation`);
      await expect(
        withActorTransaction(ownerActor, async (tx) => {
          await tx.insert(members).values({ name: "rollback" });
          throw new Error("rollback fixture");
        }),
      ).rejects.toThrow("rollback fixture");
      expect(await valkey.get(`${prefix}:generation`)).toBe(generation);
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
      mocks.token = await createSessionToken("viewer");
      expect((await searchStoredNicknames("player#kr1"))[0].memberName).toBe(
        "김**원",
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
      disconnectValkey();
      vi.stubEnv("VALKEY_URL", "");
      expect((await getMembersReadModel()).members[0].id).toBe(
        fixture.member.id,
      );
      vi.stubEnv("VALKEY_URL", "redis://127.0.0.1:1");
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
      mocks.token = await createSessionToken("viewer");
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
      expect(select).not.toHaveBeenCalled();
      const indexKeys = (await keys()).filter((key) =>
        key.includes(":autocomplete:"),
      );
      expect(indexKeys).toHaveLength(3);
      for (const key of indexKeys) {
        expect(await valkey.ttl(key)).toBeGreaterThanOrEqual(58);
        expect(await valkey.ttl(key)).toBeLessThanOrEqual(60);
        if (key.endsWith(":accounts")) {
          const payload = JSON.stringify(await valkey.hgetall(key));
          expect(payload).not.toContain("김모임원");
          expect(payload).not.toContain("birthYear");
          expect(payload).not.toContain("memberId");
        }
        if (key.endsWith(":names")) {
          expect(await valkey.zrange(key, "0", "-1", "WITHSCORES")).toEqual([
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
      await linkAccount(imported.id, fixture.member.id);
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
      await valkey.hset(hash, name, "invalid JSON");
      expect(await autocompleteStoredNicknames("re")).toHaveLength(1);
      expect(JSON.parse((await valkey.hget(hash, name))!).gameName).toBe(
        "rebuild",
      );
      await valkey.del(hash);
      expect(await autocompleteStoredNicknames("re")).toHaveLength(1);
      await valkey.pexpire(marker, 1);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const select = vi.spyOn(db, "select");
      await autocompleteStoredNicknames("re");
      expect(select).toHaveBeenCalledTimes(1);
      await unlinkAccount(fixture.account.id);
      await autocompleteStoredNicknames("re");
      select.mockClear();
      expect(await autocompleteStoredNicknames("anything")).toEqual([]);
      expect(select).not.toHaveBeenCalled();
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
      const previous = await valkey.get(`${prefix}:generation`);
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
      expect(await valkey.get(`${prefix}:generation`)).not.toBe(previous);
    });

    it("does not publish a half-built snapshot when a temporary key disappears", async () => {
      const fixture = { id: randomUUID(), gameName: "Atomic", tagLine: "KR1" };
      const original = valkey.eval.bind(valkey);
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(valkey, "eval").mockImplementation(async (...args) => {
        if (args[1] === 5) await valkey.del(String(args[2]));
        return original(...args);
      });
      const load = vi.fn().mockResolvedValue([fixture]);
      expect(await queryNicknameAutocomplete("a", load)).toEqual([fixture]);
      expect(load).toHaveBeenCalledTimes(1);
      vi.restoreAllMocks();
      disconnectValkey();
      valkey = (await getValkeyConnection())!.client;
      const indexKeys = (await keys()).filter((key) =>
        key.includes(":autocomplete:"),
      );
      expect(indexKeys.some((key) => key.endsWith(":ready"))).toBe(false);
      for (const key of indexKeys)
        expect(await valkey.ttl(key)).toBeGreaterThan(0);
      expect(await queryNicknameAutocomplete("a", load)).toEqual([fixture]);
      expect(load).toHaveBeenCalledTimes(2);
    });

    it("propagates a failing DB build once even with an invalid generation", async () => {
      await valkey.set(`${prefix}:generation`, "damaged");
      const load = vi.fn().mockRejectedValue(new Error("DB snapshot failed"));
      await expect(queryNicknameAutocomplete("a", load)).rejects.toThrow(
        "DB snapshot failed",
      );
      expect(load).toHaveBeenCalledTimes(1);
      await valkey.del(`${prefix}:generation`);
      load.mockClear();
      await expect(queryNicknameAutocomplete("a", load)).rejects.toThrow(
        "DB snapshot failed",
      );
      expect(load).toHaveBeenCalledTimes(1);
    });

    it("returns the DB snapshot on an actual command failure and propagates DB errors only once", async () => {
      const fixture = await seed("fallback");
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(valkey, "eval").mockRejectedValueOnce(
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
      disconnectValkey();
      vi.stubEnv("VALKEY_URL", "");
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
      mocks.token = await createSessionToken("viewer");
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
      expect(JSON.stringify(result)).not.toContain("김모임원");
      expect(JSON.stringify(result)).not.toContain("birthYear");
      if (result.kind === "ambiguous")
        expect(
          result.accounts.every((account) => account.memberName === "김**원"),
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
      // Simulate a DB change whose Valkey invalidation was lost.
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
