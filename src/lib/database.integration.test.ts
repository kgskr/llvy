import { randomUUID } from "node:crypto";

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

import { gameParticipants, games, members, riotAccounts } from "@/db/schema";
import {
  client,
  db,
  migrateTestDatabase,
  resetTestDatabase,
} from "@/test/database";
import { replayBytes, replayPlayer, tenReplayPlayers } from "@/test/replay";

vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => ({ db: (await import("@/test/database")).db }));

import { countGames, getGameDetail, listGames } from "./games";
import { ingestReplay } from "./ingest";
import {
  createMember,
  linkAccount,
  listMembersWithAccounts,
  listUnlinkedAccounts,
  unlinkAccount,
  updateMember,
} from "./members";

const playedAt = new Date("2026-09-01T12:34:56.000Z");

function ingest(
  bytes = replayBytes(),
  overrides: Partial<Parameters<typeof ingestReplay>[0]> = {},
) {
  return ingestReplay({
    bytes,
    blobUrl: "https://example.invalid/replays/game.rofl",
    originalFilename: "game.rofl",
    lastModified: playedAt.getTime(),
    ...overrides,
  });
}

async function rowCounts() {
  const result = await client.query<{
    games: number;
    accounts: number;
    participants: number;
  }>(`
    SELECT (SELECT count(*)::int FROM games) AS games,
           (SELECT count(*)::int FROM riot_accounts) AS accounts,
           (SELECT count(*)::int FROM game_participants) AS participants
  `);
  return result.rows[0];
}

beforeAll(migrateTestDatabase, 30_000);
beforeEach(resetTestDatabase);
afterEach(() => vi.restoreAllMocks());
afterAll(() => client.close());

describe("stored migrations and replay ingestion", () => {
  it("reapplies the migration journal without losing existing data", async () => {
    const memberId = await createMember("마이그레이션 확인", 1994);
    await migrateTestDatabase();
    const rows = await db.select().from(members);
    expect(rows).toEqual([
      expect.objectContaining({ id: memberId, name: "마이그레이션 확인" }),
    ]);
    const journal = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM drizzle."__drizzle_migrations"',
    );
    expect(journal.rows[0].count).toBe(3);
  });

  it.each(["legacy", "rofl2"] as const)(
    "parses and stores a %s replay, then reads the game and participants",
    async (format) => {
      const result = await ingest(replayBytes({ format }));
      expect(result.duplicate).toBe(false);
      expect(await rowCounts()).toEqual({
        games: 1,
        accounts: 10,
        participants: 10,
      });
      expect(await listGames()).toEqual([
        {
          id: result.gameId,
          playedAt,
          playedAtSource: "file_mtime",
          durationMs: 1834567,
          winningTeam: 100,
          participantCount: 10,
        },
      ]);
      const detail = await getGameDetail(result.gameId);
      expect(detail).toMatchObject({
        id: result.gameId,
        playedAt,
        playedAtSource: "file_mtime",
        gameVersion: "14.23.1.1",
        originalFilename: "game.rofl",
        winningTeam: 100,
      });
      expect(detail?.participants).toHaveLength(10);
      expect(
        detail?.participants.find((p) => p.gameName === "Player1"),
      ).toMatchObject({
        team: 100,
        position: "TOP",
        champion: "Ahri",
        win: true,
        kills: 10,
        deaths: 2,
        assists: 7,
        goldEarned: 15000,
        tagLine: "KR1",
        memberId: null,
        memberName: null,
      });
      const storedGames = await db.select().from(games);
      expect(storedGames[0].rawMetadata).not.toHaveProperty("statsJson");
      const storedParticipants = await db.select().from(gameParticipants);
      expect(storedParticipants[0].rawStats).toHaveProperty("SKIN", "Ahri");
    },
  );

  it("returns the original game for the same bytes without rewriting metadata", async () => {
    const original = await ingest();
    const duplicate = await ingest(replayBytes(), {
      blobUrl: "https://example.invalid/replays/duplicate.rofl",
      originalFilename: "duplicate.rofl",
      lastModified: playedAt.getTime() - 86_400_000,
    });
    expect(duplicate).toEqual({ gameId: original.gameId, duplicate: true });
    expect(await rowCounts()).toEqual({
      games: 1,
      accounts: 10,
      participants: 10,
    });
    expect(await getGameDetail(original.gameId)).toMatchObject({
      originalFilename: "game.rofl",
      playedAt,
    });
  });

  it("deduplicates overlapping requests for the same replay", async () => {
    // PGlite serializes its single connection: this exercises overlapping
    // callers and the conflict branch, not multi-connection lock contention.
    const results = await Promise.all([ingest(), ingest(), ingest()]);
    expect(new Set(results.map((result) => result.gameId)).size).toBe(1);
    expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
    expect(await rowCounts()).toEqual({
      games: 1,
      accounts: 10,
      participants: 10,
    });
  });

  it.each(["puuid", "legacy"] as const)(
    "writes accounts in the same order for opposing participant orders (%s)",
    async (identity) => {
      const players = tenReplayPlayers().map((player) => ({
        ...player,
        ...(identity === "legacy" ? { PUUID: null } : {}),
      }));
      await client.exec(`
        CREATE TABLE test_account_write_order (
          id bigserial PRIMARY KEY,
          puuid text,
          game_name text,
          tag_line text
        );
        CREATE FUNCTION record_test_account_write() RETURNS trigger AS $$
        BEGIN
          INSERT INTO test_account_write_order (puuid, game_name, tag_line)
          VALUES (NEW.puuid, NEW.game_name, NEW.tag_line);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER record_test_account_write AFTER INSERT OR UPDATE
        ON riot_accounts FOR EACH ROW EXECUTE FUNCTION record_test_account_write();
      `);
      const writeOrder = async () =>
        (
          await client.query<{ identity: string }>(`
          SELECT coalesce(puuid, game_name || '#' || tag_line) AS identity
          FROM test_account_write_order ORDER BY id
        `)
        ).rows.map((row) => row.identity);
      try {
        await ingest(replayBytes({ players }));
        const originalOrder = await writeOrder();
        // Existing PUUID accounts also take UPDATE locks. Legacy accounts
        // take write locks only on creation, so reset those before replaying.
        if (identity === "legacy") await resetTestDatabase();
        await client.exec("TRUNCATE test_account_write_order");
        await ingest(replayBytes({ players: [...players].reverse() }));
        expect(originalOrder).toHaveLength(10);
        expect(new Set(originalOrder).size).toBe(10);
        expect(await writeOrder()).toEqual(originalOrder);
        expect(await rowCounts()).toEqual({
          games: identity === "legacy" ? 1 : 2,
          accounts: 10,
          participants: identity === "legacy" ? 10 : 20,
        });
      } finally {
        await client.exec(`
          DROP TRIGGER record_test_account_write ON riot_accounts;
          DROP FUNCTION record_test_account_write();
          DROP TABLE test_account_write_order;
        `);
      }
    },
  );

  it.each(["40P01", "40001"])(
    "retries the whole transaction after a PostgreSQL rollback (%s)",
    async (code) => {
      // Sequences survive rollback, so only the first attempt fails. The
      // failure happens after game/account writes and comes through Drizzle's
      // real cause wrapper. This does not simulate multi-connection locking.
      await client.exec(`
        CREATE SEQUENCE test_ingest_attempt;
        CREATE FUNCTION fail_test_ingest_once() RETURNS trigger AS $$
        BEGIN
          IF nextval('test_ingest_attempt') = 1 THEN
            RAISE EXCEPTION 'test transaction rollback' USING ERRCODE = '${code}';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER fail_test_ingest_once BEFORE INSERT ON game_participants
        FOR EACH ROW EXECUTE FUNCTION fail_test_ingest_once();
      `);
      const transactions = vi.spyOn(db, "transaction");
      try {
        const result = await ingest();
        expect(result.duplicate).toBe(false);
        expect(transactions).toHaveBeenCalledTimes(2);
        expect(await rowCounts()).toEqual({
          games: 1,
          accounts: 10,
          participants: 10,
        });
        expect((await getGameDetail(result.gameId))?.participants).toHaveLength(
          10,
        );
        expect(await ingest()).toEqual({
          gameId: result.gameId,
          duplicate: true,
        });
        expect(transactions).toHaveBeenCalledTimes(2);
      } finally {
        await client.exec(`
          DROP TRIGGER fail_test_ingest_once ON game_participants;
          DROP FUNCTION fail_test_ingest_once();
          DROP SEQUENCE test_ingest_attempt;
        `);
      }
    },
  );

  it("stops after three rolled-back transaction attempts", async () => {
    await client.exec(`
      CREATE FUNCTION fail_test_ingest_always() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'persistent test deadlock' USING ERRCODE = '40P01';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_test_ingest_always BEFORE INSERT ON game_participants
      FOR EACH ROW EXECUTE FUNCTION fail_test_ingest_always();
    `);
    const transactions = vi.spyOn(db, "transaction");
    try {
      await expect(ingest()).rejects.toThrow();
      expect(transactions).toHaveBeenCalledTimes(3);
      expect(await rowCounts()).toEqual({
        games: 0,
        accounts: 0,
        participants: 0,
      });
    } finally {
      await client.exec(`
        DROP TRIGGER fail_test_ingest_always ON game_participants;
        DROP FUNCTION fail_test_ingest_always();
      `);
    }
  });

  it.each(["unknown", "ECONNRESET"])(
    "does not retry a lost COMMIT response (%s)",
    async (code) => {
      const lostReply =
        code === "unknown"
          ? new Error("connection lost after COMMIT")
          : Object.assign(
              new Error("connection lost after COMMIT", {
                // An outer transport error must take precedence over an older
                // rollback error in its cause chain.
                cause: Object.assign(new Error("earlier database error"), {
                  code: "40P01",
                }),
              }),
              { code },
            );
      const transaction = db.transaction.bind(db);
      const transactions = vi
        .spyOn(db, "transaction")
        .mockImplementationOnce(async (work, config) => {
          await transaction(work, config);
          throw lostReply;
        });
      await expect(ingest()).rejects.toBe(lostReply);
      expect(transactions).toHaveBeenCalledTimes(1);
      expect(await rowCounts()).toEqual({
        games: 1,
        accounts: 10,
        participants: 10,
      });
    },
  );

  it("rolls back the game, accounts, and participants when the final insert fails", async () => {
    await client.exec(`
      CREATE FUNCTION reject_test_participant() RETURNS trigger AS $$
      BEGIN
        IF NEW.position = 'MIDDLE' THEN
          RAISE EXCEPTION 'test participant write failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_test_participant BEFORE INSERT ON game_participants
      FOR EACH ROW EXECUTE FUNCTION reject_test_participant();
    `);
    const transactions = vi.spyOn(db, "transaction");
    try {
      await expect(ingest()).rejects.toThrow();
      expect(transactions).toHaveBeenCalledTimes(1);
      expect(await rowCounts()).toEqual({
        games: 0,
        accounts: 0,
        participants: 0,
      });
    } finally {
      await client.exec(`
        DROP TRIGGER reject_test_participant ON game_participants;
        DROP FUNCTION reject_test_participant();
      `);
    }
    expect((await ingest()).duplicate).toBe(false);
  });

  it("rejects duplicate participant identities without retaining any partial data", async () => {
    const players = tenReplayPlayers();
    players[8] = replayPlayer({
      PUUID: "puuid-1",
      RIOT_ID_GAME_NAME: "Duplicate",
    });
    await expect(ingest(replayBytes({ players }))).rejects.toThrow();
    expect(await rowCounts()).toEqual({
      games: 0,
      accounts: 0,
      participants: 0,
    });
  });

  it("does not retain a game or accounts when parsing fails", async () => {
    await expect(ingest(new Uint8Array([1, 2, 3]))).rejects.toThrow();
    expect(await rowCounts()).toEqual({
      games: 0,
      accounts: 0,
      participants: 0,
    });
  });

  it.each([null, 0, Date.UTC(2008, 0, 1), Date.UTC(2100, 0, 1)])(
    "uses upload time for an absent or implausible file date (%s)",
    async (lastModified) => {
      const before = Date.now();
      const { gameId } = await ingest(replayBytes(), { lastModified });
      const detail = await getGameDetail(gameId);
      expect(detail?.playedAtSource).toBe("upload");
      expect(detail?.playedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(detail?.playedAt.getTime()).toBeLessThanOrEqual(Date.now());
    },
  );

  it("orders by play date and supports bounded pages and totals", async () => {
    const recent = await ingest();
    const older = await ingest(
      replayBytes({ metadata: { gameVersion: "14.22.1.1" } }),
      {
        lastModified: playedAt.getTime() - 86_400_000,
      },
    );
    expect(await countGames()).toBe(2);
    expect((await listGames()).map((game) => game.id)).toEqual([
      recent.gameId,
      older.gameId,
    ]);
    expect((await listGames(1, 1)).map((game) => game.id)).toEqual([
      older.gameId,
    ]);
    expect(await listGames(1, 2)).toEqual([]);
    expect(await getGameDetail(randomUUID())).toBeNull();
    expect(await getGameDetail("not-a-uuid")).toBeNull();
  });
});

describe("member identities and retroactive account links", () => {
  it("resolves old games through account links and keeps member IDs stable on edits", async () => {
    const { gameId } = await ingest();
    const accounts = await listUnlinkedAccounts();
    expect(accounts).toHaveLength(10);
    expect(accounts.every((account) => account.gameCount === 1)).toBe(true);
    const account = accounts.find((entry) => entry.gameName === "Player1")!;
    const memberId = await createMember("기존 이름", 1995);
    expect(await linkAccount(account.id, memberId)).toBe(true);
    expect(
      (await getGameDetail(gameId))?.participants.find(
        (p) => p.gameName === "Player1",
      ),
    ).toMatchObject({
      memberId,
      memberName: "기존 이름",
    });
    expect(await updateMember(memberId, "새 이름", null)).toBe(true);
    expect(await listMembersWithAccounts()).toEqual([
      {
        id: memberId,
        name: "새 이름",
        birthYear: null,
        accounts: [{ id: account.id, gameName: "Player1", tagLine: "KR1" }],
      },
    ]);
    expect(
      (await getGameDetail(gameId))?.participants.find(
        (p) => p.memberId === memberId,
      )?.memberName,
    ).toBe("새 이름");
    expect(await listUnlinkedAccounts()).toHaveLength(9);
    expect(await unlinkAccount(account.id)).toBe(true);
    expect(
      (await getGameDetail(gameId))?.participants.find(
        (p) => p.gameName === "Player1",
      ),
    ).toMatchObject({
      memberId: null,
      memberName: null,
    });
    expect(await listUnlinkedAccounts()).toHaveLength(10);
    const [unlinked] = await db
      .select()
      .from(riotAccounts)
      .where(eq(riotAccounts.id, account.id));
    expect(unlinked.linkedAt).toBeNull();
  });

  it("preserves account and member identity after a PUUID-backed Riot ID rename", async () => {
    const first = await ingest();
    const [account] = await db
      .select()
      .from(riotAccounts)
      .where(eq(riotAccounts.puuid, "puuid-1"));
    const memberId = await createMember("회원", 2000);
    await linkAccount(account.id, memberId);
    const players = tenReplayPlayers();
    players[0] = replayPlayer({
      RIOT_ID_GAME_NAME: "Renamed",
      RIOT_ID_TAG_LINE: "NEW",
    });
    const second = await ingest(replayBytes({ players }));
    expect(await rowCounts()).toEqual({
      games: 2,
      accounts: 10,
      participants: 20,
    });
    for (const gameId of [first.gameId, second.gameId]) {
      expect(
        (await getGameDetail(gameId))?.participants.find(
          (p) => p.memberId === memberId,
        ),
      ).toMatchObject({
        gameName: "Renamed",
        tagLine: "NEW",
        memberName: "회원",
      });
    }
    const [renamed] = await db
      .select()
      .from(riotAccounts)
      .where(eq(riotAccounts.puuid, "puuid-1"));
    expect(renamed.id).toBe(account.id);
    expect(renamed.linkedAt).not.toBeNull();
  });

  it("deduplicates legacy accounts by their Riot ID", async () => {
    const players = [
      replayPlayer({ PUUID: null }),
      replayPlayer({
        RIOT_ID_GAME_NAME: "Player2",
        PUUID: null,
        TEAM: "200",
        WIN: "Fail",
      }),
    ];
    await ingest(replayBytes({ players }));
    await ingest(replayBytes({ players, format: "rofl2" }));
    expect(await rowCounts()).toEqual({
      games: 2,
      accounts: 2,
      participants: 4,
    });
    expect(
      (await listUnlinkedAccounts()).map((account) => account.gameCount),
    ).toEqual([2, 2]);
  });

  it.each(["legacy-first", "puuid-first"] as const)(
    "keeps linked legacy identity safe until an explicit PUUID link (%s)",
    async (order) => {
      const legacyPlayers = tenReplayPlayers();
      legacyPlayers[0] = replayPlayer({ PUUID: null });
      const legacy = replayBytes({ players: legacyPlayers });
      const stable = replayBytes();
      const first = await ingest(order === "legacy-first" ? legacy : stable);
      const [account] = await db
        .select()
        .from(riotAccounts)
        .where(eq(riotAccounts.gameName, "Player1"));
      const memberId = await createMember("변하지 않는 회원", 1990);
      await linkAccount(account.id, memberId);
      const second = await ingest(order === "legacy-first" ? stable : legacy);
      expect(await rowCounts()).toEqual({
        games: 2,
        accounts: order === "legacy-first" ? 11 : 10,
        participants: 20,
      });
      const [resolved] = await db
        .select()
        .from(riotAccounts)
        .where(eq(riotAccounts.puuid, "puuid-1"));
      if (order === "legacy-first") {
        expect(resolved).toMatchObject({ memberId: null });
        expect(resolved.id).not.toBe(account.id);
        const [legacyAccount] = await db
          .select()
          .from(riotAccounts)
          .where(eq(riotAccounts.id, account.id));
        expect(legacyAccount).toMatchObject({ puuid: null, memberId });
        expect(
          (await getGameDetail(second.gameId))?.participants.find(
            (p) => p.gameName === "Player1",
          ),
        ).toMatchObject({ memberId: null });
        await linkAccount(resolved.id, memberId);
      } else {
        expect(resolved).toMatchObject({ id: account.id, memberId });
      }
      for (const gameId of [first.gameId, second.gameId]) {
        expect(
          (await getGameDetail(gameId))?.participants.find(
            (p) => p.gameName === "Player1",
          ),
        ).toMatchObject({
          memberId,
          memberName: "변하지 않는 회원",
        });
      }
    },
  );

  it("does not attach an ambiguous legacy Riot ID to either stable PUUID identity", async () => {
    for (const puuid of ["stable-a", "stable-b"]) {
      await ingest(replayBytes({ players: [replayPlayer({ PUUID: puuid })] }));
      const [account] = await db
        .select()
        .from(riotAccounts)
        .where(eq(riotAccounts.puuid, puuid));
      await linkAccount(account.id, await createMember(puuid, null));
    }
    const legacy = replayBytes({ players: [replayPlayer({ PUUID: null })] });
    const firstLegacy = await ingest(legacy);
    await ingest(
      replayBytes({
        players: [replayPlayer({ PUUID: null })],
        format: "rofl2",
      }),
    );
    expect(await rowCounts()).toEqual({
      games: 4,
      accounts: 3,
      participants: 4,
    });
    expect(
      (await getGameDetail(firstLegacy.gameId))?.participants[0],
    ).toMatchObject({ memberId: null, memberName: null });
    const unlinked = await listUnlinkedAccounts();
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0].gameCount).toBe(2);

    // A later PUUID does not prove which of the namesakes owned the legacy
    // matches. Keep the manually resolved legacy history separate as well.
    const legacyMemberId = await createMember("이전 경기 회원", null);
    await linkAccount(unlinked[0].id, legacyMemberId);
    const later = await ingest(
      replayBytes({ players: [replayPlayer({ PUUID: "stable-c" })] }),
    );
    expect(await rowCounts()).toEqual({
      games: 5,
      accounts: 4,
      participants: 5,
    });
    const [legacyAccount] = await db
      .select()
      .from(riotAccounts)
      .where(eq(riotAccounts.id, unlinked[0].id));
    expect(legacyAccount).toMatchObject({
      puuid: null,
      memberId: legacyMemberId,
    });
    expect(
      (await getGameDetail(firstLegacy.gameId))?.participants[0].memberId,
    ).toBe(legacyMemberId);
    expect((await getGameDetail(later.gameId))?.participants[0]).toMatchObject({
      memberId: null,
      memberName: null,
    });
  });

  it("includes members without accounts and reports missing mutation targets", async () => {
    const memberId = await createMember("아직 계정 없음", null);
    expect(await listMembersWithAccounts()).toEqual([
      { id: memberId, name: "아직 계정 없음", birthYear: null, accounts: [] },
    ]);
    expect(await updateMember(randomUUID(), "없음", null)).toBe(false);
    expect(await linkAccount(randomUUID(), memberId)).toBe(false);
    expect(await unlinkAccount(randomUUID())).toBe(false);
  });
});
