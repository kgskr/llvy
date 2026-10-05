import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { gameParticipants, games, riotAccounts } from "@/db/schema";
import {
  client,
  db,
  migrateTestDatabase,
  resetTestDatabase,
} from "@/test/database";
import { replayBytes, replayPlayer } from "@/test/replay";

vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => ({ db: (await import("@/test/database")).db }));

import {
  countGames,
  getGameDetail,
  listGames,
  setGameExcluded,
  setGamePlayedAt,
} from "./games";
import { ingestReplay } from "./ingest";
import { getMemberHistory } from "./member-history";
import { createMember, linkAccount, unlinkAccount } from "./members";

const day = (offset: number) => new Date(Date.UTC(2026, 8, 1 + offset, 12));
const emptyStats = {
  totalGames: 0,
  wins: 0,
  losses: 0,
  undecided: 0,
  winRate: null,
  averageKills: null,
  averageDeaths: null,
  averageAssists: null,
};
let sequence = 0;

function player(puuid: string, overrides: Record<string, unknown> = {}) {
  return replayPlayer({ PUUID: puuid, RIOT_ID_GAME_NAME: puuid, ...overrides });
}

async function storeGame(
  participants = [
    player("main"),
    player("opponent", { TEAM: "200", WIN: "Fail" }),
  ],
  playedAt = day(++sequence),
) {
  const bytes = replayBytes({
    players: participants,
    metadata: { lastGameChunkId: ++sequence },
  });
  const blobUrl = `https://example.invalid/replays/${sequence}.rofl`;
  const result = await ingestReplay({
    bytes,
    blobUrl,
    originalFilename: `match-${sequence}.rofl`,
    lastModified: playedAt.getTime(),
  });
  return { ...result, bytes, blobUrl, playedAt };
}

async function linkPuuid(puuid: string, memberId: string) {
  const [account] = await db
    .select()
    .from(riotAccounts)
    .where(eq(riotAccounts.puuid, puuid));
  expect(await linkAccount(account.id, memberId)).toBe(true);
  return account.id;
}

beforeAll(migrateTestDatabase, 30_000);
beforeEach(async () => {
  sequence = 0;
  await resetTestDatabase();
});
afterAll(() => client.close());

describe("match management persistence", () => {
  it("migrates existing games with null management columns and preserves linked participants on reapplication", async () => {
    const migrationsFolder = fileURLToPath(
      new URL("../../drizzle", import.meta.url),
    );
    const oldMigrations = await mkdtemp(join(tmpdir(), "llvy-old-migrations-"));
    const previousClient = new PGlite();
    const previousDb = drizzle(previousClient);
    try {
      const journal = JSON.parse(
        await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
      ) as {
        entries: { idx: number; tag: string }[];
        [key: string]: unknown;
      };
      const previousEntries = journal.entries.filter((entry) => entry.idx < 2);
      await mkdir(join(oldMigrations, "meta"));
      await writeFile(
        join(oldMigrations, "meta/_journal.json"),
        JSON.stringify({ ...journal, entries: previousEntries }),
      );
      await Promise.all(
        previousEntries.map((entry) =>
          copyFile(
            join(migrationsFolder, `${entry.tag}.sql`),
            join(oldMigrations, `${entry.tag}.sql`),
          ),
        ),
      );
      await migrate(previousDb, { migrationsFolder: oldMigrations });

      const gameId = randomUUID();
      const accountId = randomUUID();
      const memberId = randomUUID();
      await previousClient.query(
        "INSERT INTO members (id, name) VALUES ($1, 'Existing member')",
        [memberId],
      );
      await previousClient.query(
        "INSERT INTO riot_accounts (id, member_id, game_name, tag_line, puuid) VALUES ($1, $2, 'Existing account', 'KR1', 'existing-puuid')",
        [accountId, memberId],
      );
      await previousClient.query(
        "INSERT INTO games (id, file_hash, blob_url, played_at, played_at_source, duration_ms, raw_metadata) VALUES ($1, 'original-hash', 'https://example.invalid/original.rofl', $2, 'file_mtime', 1200000, '{\"gameLength\":1200000}')",
        [gameId, day(0).toISOString()],
      );
      await previousClient.query(
        "INSERT INTO game_participants (game_id, riot_account_id, team, champion, kills) VALUES ($1, $2, 100, 'Ahri', 8)",
        [gameId, accountId],
      );
      const before = await previousClient.query<{
        game: Record<string, unknown>;
      }>("SELECT row_to_json(g) AS game FROM games g");

      await migrate(previousDb, { migrationsFolder });
      await migrate(previousDb, { migrationsFolder });
      const after = await previousClient.query<{
        game: Record<string, unknown>;
      }>("SELECT row_to_json(g) AS game FROM games g");
      expect(after.rows[0].game).toEqual({
        ...before.rows[0].game,
        excluded_at: null,
        played_at_override: null,
      });
      const preserved = await previousClient.query(
        "SELECT p.champion, p.kills, a.member_id FROM game_participants p JOIN riot_accounts a ON a.id = p.riot_account_id",
      );
      expect(preserved.rows).toEqual([
        { champion: "Ahri", kills: 8, member_id: memberId },
      ]);
      const applied = await previousClient.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM drizzle."__drizzle_migrations"',
      );
      expect(applied.rows[0].count).toBe(5);
    } finally {
      await previousClient.close();
      await rm(oldMigrations, { recursive: true, force: true });
    }
  }, 30_000);

  it("excludes and restores games while retaining detail, participants and canonical replay", async () => {
    const first = await storeGame(undefined, day(1));
    const second = await storeGame(undefined, day(2));
    const [original] = await db
      .select()
      .from(games)
      .where(eq(games.id, first.gameId));
    const originalParticipants = await db
      .select()
      .from(gameParticipants)
      .where(eq(gameParticipants.gameId, first.gameId));
    expect(await setGameExcluded(first.gameId, true)).toBe(true);
    expect((await listGames()).map((game) => game.id)).toEqual([second.gameId]);
    expect(await countGames()).toBe(1);
    expect(await countGames("excluded")).toBe(1);
    expect((await listGames(1, 0, "excluded")).map((game) => game.id)).toEqual([
      first.gameId,
    ]);
    expect(await listGames(1, 1, "excluded")).toEqual([]);
    expect((await getGameDetail(first.gameId))?.excludedAt).toBeInstanceOf(
      Date,
    );
    expect((await getGameDetail(first.gameId))?.participants).toHaveLength(2);

    expect(await setGameExcluded(first.gameId, false)).toBe(true);
    expect(await countGames()).toBe(2);
    expect(await countGames("excluded")).toBe(0);
    expect((await listGames()).map((game) => game.id)).toEqual([
      second.gameId,
      first.gameId,
    ]);
    expect((await getGameDetail(first.gameId))?.excludedAt).toBeNull();
    expect(
      await db.select().from(games).where(eq(games.id, first.gameId)),
    ).toEqual([original]);
    expect(
      await db
        .select()
        .from(gameParticipants)
        .where(eq(gameParticipants.gameId, first.gameId)),
    ).toEqual(originalParticipants);
  });

  it("deduplicates an excluded replay without restoring it or replacing its canonical blob", async () => {
    const original = await storeGame();
    await setGameExcluded(original.gameId, true);
    const before = await db.select().from(games);
    const duplicate = await ingestReplay({
      bytes: original.bytes,
      blobUrl: "https://example.invalid/duplicate.rofl",
      originalFilename: "duplicate.rofl",
      lastModified: null,
    });
    expect(duplicate).toEqual({ gameId: original.gameId, duplicate: true });
    expect(await db.select().from(games)).toEqual(before);
    expect(await countGames()).toBe(0);
    expect(await countGames("excluded")).toBe(1);
    expect(
      await db.select({ id: gameParticipants.id }).from(gameParticipants),
    ).toHaveLength(2);
    expect((await getGameDetail(original.gameId))?.excludedAt).toBeInstanceOf(
      Date,
    );
  });

  it("sorts list and member history by the corrected date, then restores immutable original values", async () => {
    const older = await storeGame(undefined, day(1));
    const newer = await storeGame(undefined, day(2));
    const memberId = await createMember("Date correction member", null);
    await linkPuuid("main", memberId);
    expect(await setGamePlayedAt(older.gameId, day(3))).toBe(true);
    expect((await listGames()).map((game) => game.id)).toEqual([
      older.gameId,
      newer.gameId,
    ]);
    expect(
      (await getMemberHistory(memberId))?.games.map((game) => game.id),
    ).toEqual([older.gameId, newer.gameId]);
    expect(await getGameDetail(older.gameId)).toMatchObject({
      playedAt: day(3),
      playedAtSource: "manual",
      originalPlayedAt: day(1),
      originalPlayedAtSource: "file_mtime",
      playedAtOverride: day(3),
    });
    expect((await getMemberHistory(memberId))?.games[0]).toMatchObject({
      playedAt: day(3),
      playedAtSource: "manual",
    });
    const [stored] = await db
      .select()
      .from(games)
      .where(eq(games.id, older.gameId));
    expect(stored.playedAt).toEqual(day(1));
    expect(stored.playedAtSource).toBe("file_mtime");
    expect(stored.blobUrl).toBe(older.blobUrl);

    expect(await setGamePlayedAt(older.gameId, null)).toBe(true);
    expect(await getGameDetail(older.gameId)).toMatchObject({
      playedAt: day(1),
      playedAtSource: "file_mtime",
      originalPlayedAt: day(1),
      originalPlayedAtSource: "file_mtime",
      playedAtOverride: null,
    });
    expect((await listGames()).map((game) => game.id)).toEqual([
      newer.gameId,
      older.gameId,
    ]);
    expect(
      (await getMemberHistory(memberId))?.games.map((game) => game.id),
    ).toEqual([newer.gameId, older.gameId]);
  });

  it("preserves an upload-time source through manual correction and reset", async () => {
    const result = await ingestReplay({
      bytes: replayBytes(),
      blobUrl: "https://example.invalid/upload-time.rofl",
      originalFilename: "upload-time.rofl",
      lastModified: null,
    });
    const original = await getGameDetail(result.gameId);
    expect(original?.playedAtSource).toBe("upload");
    await setGamePlayedAt(result.gameId, day(1));
    await setGamePlayedAt(result.gameId, null);
    expect(await getGameDetail(result.gameId)).toEqual(original);
  });

  it("returns false for invalid or missing game IDs without changing stored records", async () => {
    await storeGame();
    const before = await db.select().from(games);
    for (const id of ["", "invalid-uuid", randomUUID()]) {
      expect(await setGameExcluded(id, true)).toBe(false);
      expect(await setGameExcluded(id, false)).toBe(false);
      expect(await setGamePlayedAt(id, day(1))).toBe(false);
      expect(await setGamePlayedAt(id, null)).toBe(false);
    }
    expect(await db.select().from(games)).toEqual(before);
  });
});

describe("combined member history", () => {
  it("summarizes champions across pages and accounts without excluded or ambiguous games", async () => {
    await storeGame([
      player("main", { CHAMPIONS_KILLED: "6" }),
      player("opponent", { TEAM: "200", WIN: "Fail" }),
    ]);
    await storeGame([
      player("alt", { WIN: "Fail", CHAMPIONS_KILLED: "2", NUM_DEATHS: "4" }),
      player("opponent", { TEAM: "200" }),
    ]);
    await storeGame([
      player("main", {
        SKIN: "Lux",
        WIN: "Fail",
        CHAMPIONS_KILLED: null,
        NUM_DEATHS: null,
        ASSISTS: null,
      }),
    ]);
    const excluded = await storeGame([player("main", { SKIN: "Garen" })]);
    await setGameExcluded(excluded.gameId, true);
    await storeGame([player("main"), player("alt", { SKIN: "Lux" })]);
    const unknownChampion = await storeGame([player("main")]);
    await db
      .update(gameParticipants)
      .set({ champion: null })
      .where(eq(gameParticipants.gameId, unknownChampion.gameId));
    const memberId = await createMember("Champion summary", 1997);
    await linkPuuid("main", memberId);
    await linkPuuid("alt", memberId);

    const history = await getMemberHistory(memberId, 1, 1);
    expect(history?.games).toHaveLength(1);
    expect(history?.championStats).toEqual([
      {
        champion: "Ahri",
        position: "MIDDLE",
        totalGames: 2,
        wins: 1,
        losses: 1,
        undecided: 0,
        winRate: 50,
        averageKills: 4,
        averageDeaths: 3,
        averageAssists: 7,
      },
      {
        champion: "Lux",
        position: "MIDDLE",
        ...emptyStats,
        totalGames: 1,
        undecided: 1,
      },
    ]);
    expect((await getMemberHistory(memberId, 1, 100))?.championStats).toEqual(
      history?.championStats,
    );
    await setGameExcluded(excluded.gameId, false);
    expect(
      (await getMemberHistory(memberId))?.championStats.map(
        (row) => row.champion,
      ),
    ).toEqual(["Ahri", "Garen", "Lux"]);
  });

  it("separates champion positions and combines matching and unknown positions across accounts", async () => {
    await storeGame([
      player("main", { TEAM_POSITION: "MIDDLE", CHAMPIONS_KILLED: "6" }),
      player("opponent", { TEAM: "200", WIN: "Fail" }),
    ]);
    await storeGame([
      player("alt", {
        TEAM_POSITION: "MIDDLE",
        CHAMPIONS_KILLED: "2",
        WIN: "Fail",
      }),
      player("opponent", { TEAM: "200" }),
    ]);
    const support = await storeGame([
      player("main", { TEAM_POSITION: "UTILITY", CHAMPIONS_KILLED: "1" }),
      player("opponent", { TEAM: "200", WIN: "Fail" }),
    ]);
    for (const account of ["main", "alt"]) {
      await storeGame([
        player(account, {
          TEAM_POSITION: null,
          INDIVIDUAL_POSITION: null,
          CHAMPIONS_KILLED: "4",
        }),
      ]);
    }
    const memberId = await createMember("Position summary", 1997);
    await linkPuuid("main", memberId);
    await linkPuuid("alt", memberId);
    const history = await getMemberHistory(memberId, 1, 1);
    expect(history?.championStats).toEqual([
      {
        champion: "Ahri",
        position: "MIDDLE",
        totalGames: 2,
        wins: 1,
        losses: 1,
        undecided: 0,
        winRate: 50,
        averageKills: 4,
        averageDeaths: 2,
        averageAssists: 7,
      },
      {
        champion: "Ahri",
        position: null,
        totalGames: 2,
        wins: 0,
        losses: 0,
        undecided: 2,
        winRate: null,
        averageKills: 4,
        averageDeaths: 2,
        averageAssists: 7,
      },
      {
        champion: "Ahri",
        position: "UTILITY",
        totalGames: 1,
        wins: 1,
        losses: 0,
        undecided: 0,
        winRate: 100,
        averageKills: 1,
        averageDeaths: 2,
        averageAssists: 7,
      },
    ]);
    expect((await getMemberHistory(memberId, 1, 100))?.championStats).toEqual(
      history?.championStats,
    );
    await setGameExcluded(support.gameId, true);
    expect(
      (await getMemberHistory(memberId))?.championStats.map(
        (row) => row.position,
      ),
    ).toEqual(["MIDDLE", null]);
    await setGameExcluded(support.gameId, false);
    expect((await getMemberHistory(memberId))?.championStats).toEqual(
      history?.championStats,
    );
  });

  it("summarizes positions independently of champions and pages while excluding ambiguous games", async () => {
    await storeGame([
      player("main"),
      player("opponent", { TEAM: "200", WIN: "Fail" }),
    ]);
    await storeGame([
      player("alt", { SKIN: "Lux", WIN: "Fail" }),
      player("opponent", { TEAM: "200" }),
    ]);
    const missingChampion = await storeGame([
      player("main", { SKIN: "Garen" }),
    ]);
    await db
      .update(gameParticipants)
      .set({ champion: null })
      .where(eq(gameParticipants.gameId, missingChampion.gameId));
    const support = await storeGame([
      player("alt", { TEAM_POSITION: "UTILITY" }),
      player("opponent", { TEAM: "200", WIN: "Fail" }),
    ]);
    await storeGame([
      player("main", { TEAM_POSITION: null, INDIVIDUAL_POSITION: null }),
    ]);
    await storeGame([
      player("main", { TEAM_POSITION: "TOP" }),
      player("alt", { TEAM_POSITION: "TOP" }),
    ]);
    const memberId = await createMember("Position totals", null);
    await linkPuuid("main", memberId);
    const altId = await linkPuuid("alt", memberId);
    const expected = [
      { position: "MIDDLE", totalGames: 3, winRate: 50 },
      { position: "UTILITY", totalGames: 1, winRate: 100 },
      { position: null, totalGames: 1, winRate: null },
    ];
    expect((await getMemberHistory(memberId, 1, 1))?.positionStats).toEqual(
      expected,
    );
    expect((await getMemberHistory(memberId, 1, 100))?.positionStats).toEqual(
      expected,
    );
    await setGameExcluded(support.gameId, true);
    expect((await getMemberHistory(memberId))?.positionStats).toEqual([
      expected[0],
      expected[2],
    ]);
    await setGameExcluded(support.gameId, false);
    expect((await getMemberHistory(memberId))?.positionStats).toEqual(expected);
    await unlinkAccount(altId);
    expect((await getMemberHistory(memberId))?.positionStats).toEqual([
      { position: "MIDDLE", totalGames: 2, winRate: 100 },
      { position: "TOP", totalGames: 1, winRate: null },
      expected[2],
    ]);
  });

  it("combines accounts with independent non-null averages and page-independent aggregates", async () => {
    const first = await storeGame(
      [
        player("main", {
          CHAMPIONS_KILLED: "10",
          NUM_DEATHS: null,
          ASSISTS: "8",
        }),
        player("opponent", { TEAM: "200", WIN: "Fail" }),
      ],
      day(1),
    );
    const second = await storeGame(
      [
        player("alt", {
          WIN: "Fail",
          CHAMPIONS_KILLED: null,
          NUM_DEATHS: "4",
          ASSISTS: null,
        }),
        player("opponent", { TEAM: "200", WIN: "Win" }),
      ],
      day(2),
    );
    const third = await storeGame(
      [
        player("main", {
          WIN: "Fail",
          CHAMPIONS_KILLED: "4",
          NUM_DEATHS: "2",
          ASSISTS: "2",
        }),
        player("opponent", { TEAM: "200", WIN: "Fail" }),
      ],
      day(3),
    );
    await storeGame(
      [
        player("unlinked", { CHAMPIONS_KILLED: "99" }),
        player("opponent", { TEAM: "200", WIN: "Fail" }),
      ],
      day(4),
    );
    const memberId = await createMember("Multiple accounts", 1997);
    const accountIds = [
      await linkPuuid("main", memberId),
      await linkPuuid("alt", memberId),
    ];
    const history = await getMemberHistory(memberId, 1, 1);
    expect(history?.member).toEqual({
      id: memberId,
      name: "Multiple accounts",
      birthYear: 1997,
    });
    expect(history?.accounts.map((account) => account.id).sort()).toEqual(
      accountIds.sort(),
    );
    const stats = {
      totalGames: 3,
      wins: 1,
      losses: 1,
      undecided: 1,
      winRate: 50,
      averageKills: 7,
      averageDeaths: 3,
      averageAssists: 5,
    };
    expect(history?.stats).toEqual(stats);
    expect(history?.games.map((game) => game.id)).toEqual([second.gameId]);
    expect(history?.games[0]).toMatchObject({
      result: "loss",
      kills: null,
      deaths: 4,
      assists: null,
      ambiguous: false,
    });
    const complete = await getMemberHistory(memberId);
    expect(complete?.games.map((game) => game.id)).toEqual([
      third.gameId,
      second.gameId,
      first.gameId,
    ]);
    expect(complete?.games[0]).toMatchObject({
      result: "unknown",
      ambiguous: false,
      kills: 4,
      deaths: 2,
      assists: 2,
    });
    const beyondLastPage = await getMemberHistory(memberId, 1, 10);
    expect(beyondLastPage?.games).toEqual([]);
    expect(beyondLastPage?.stats).toEqual(stats);
  });

  it("immediately recalculates prior games after relinking, unlinking, exclusion and restoration", async () => {
    const first = await storeGame(undefined, day(1));
    const second = await storeGame(
      [
        player("alt", { WIN: "Fail", CHAMPIONS_KILLED: "2" }),
        player("opponent", { TEAM: "200", WIN: "Win" }),
      ],
      day(2),
    );
    const initialMember = await createMember("Initial owner", null);
    const newMember = await createMember("New owner", null);
    const main = await linkPuuid("main", initialMember);
    const alt = await linkPuuid("alt", initialMember);
    expect((await getMemberHistory(initialMember))?.stats.totalGames).toBe(2);
    expect((await getMemberHistory(newMember))?.stats).toEqual(emptyStats);
    await linkAccount(alt, newMember);
    expect(
      (await getMemberHistory(initialMember))?.games.map((game) => game.id),
    ).toEqual([first.gameId]);
    expect(
      (await getMemberHistory(newMember))?.games.map((game) => game.id),
    ).toEqual([second.gameId]);
    await unlinkAccount(main);
    expect((await getMemberHistory(initialMember))?.stats).toEqual(emptyStats);
    await linkAccount(main, newMember);
    const combined = await getMemberHistory(newMember);
    expect(combined?.stats).toEqual({
      totalGames: 2,
      wins: 1,
      losses: 1,
      undecided: 0,
      winRate: 50,
      averageKills: 6,
      averageDeaths: 2,
      averageAssists: 7,
    });

    await setGameExcluded(second.gameId, true);
    const excluded = await getMemberHistory(newMember);
    expect(excluded?.games.map((game) => game.id)).toEqual([first.gameId]);
    expect(excluded?.stats).toEqual({
      totalGames: 1,
      wins: 1,
      losses: 0,
      undecided: 0,
      winRate: 100,
      averageKills: 10,
      averageDeaths: 2,
      averageAssists: 7,
    });
    await setGameExcluded(second.gameId, false);
    expect(await getMemberHistory(newMember)).toEqual(combined);
    expect(
      await db.select({ id: gameParticipants.id }).from(gameParticipants),
    ).toHaveLength(4);
  });

  it("counts two linked participants once, omits ambiguous stats, and recovers after unlinking", async () => {
    const shared = await storeGame(
      [
        player("main", {
          CHAMPIONS_KILLED: "20",
          NUM_DEATHS: "6",
          ASSISTS: "3",
        }),
        player("alt", {
          TEAM: "200",
          WIN: "Fail",
          CHAMPIONS_KILLED: "100",
          NUM_DEATHS: "100",
          ASSISTS: "100",
        }),
      ],
      day(1),
    );
    const separate = await storeGame(undefined, day(2));
    const memberId = await createMember("Conflicting accounts", null);
    await linkPuuid("main", memberId);
    const altId = await linkPuuid("alt", memberId);
    const history = await getMemberHistory(memberId);
    expect(history?.games.map((game) => game.id)).toEqual([
      separate.gameId,
      shared.gameId,
    ]);
    expect(history?.games[1]).toMatchObject({
      ambiguous: true,
      result: "unknown",
      champion: null,
      position: null,
      kills: null,
      deaths: null,
      assists: null,
    });
    expect(history?.stats).toEqual({
      totalGames: 2,
      wins: 1,
      losses: 0,
      undecided: 1,
      winRate: 100,
      averageKills: 10,
      averageDeaths: 2,
      averageAssists: 7,
    });
    await setGameExcluded(separate.gameId, true);
    expect((await getMemberHistory(memberId))?.stats).toEqual({
      ...emptyStats,
      totalGames: 1,
      undecided: 1,
    });
    await setGameExcluded(separate.gameId, false);
    await unlinkAccount(altId);
    const resolved = await getMemberHistory(memberId);
    expect(resolved?.games[1]).toMatchObject({
      ambiguous: false,
      result: "win",
      champion: "Ahri",
      kills: 20,
      deaths: 6,
      assists: 3,
    });
    expect(resolved?.stats).toEqual({
      totalGames: 2,
      wins: 2,
      losses: 0,
      undecided: 0,
      winRate: 100,
      averageKills: 15,
      averageDeaths: 4,
      averageAssists: 5,
    });
  });

  it("does not invent an outcome or averages when the winner and all KDA values are missing", async () => {
    const stored = await storeGame([
      player("main", {
        WIN: "Fail",
        CHAMPIONS_KILLED: null,
        NUM_DEATHS: null,
        ASSISTS: null,
      }),
      player("opponent", { TEAM: "200", WIN: "Fail" }),
    ]);
    const memberId = await createMember("Unknown outcome", null);
    await linkPuuid("main", memberId);
    const history = await getMemberHistory(memberId);
    expect(history?.stats).toEqual({
      ...emptyStats,
      totalGames: 1,
      undecided: 1,
    });
    expect(history?.games[0]).toMatchObject({
      id: stored.gameId,
      result: "unknown",
      ambiguous: false,
      kills: null,
      deaths: null,
      assists: null,
    });
  });

  it("returns an empty history for existing members with no games and null for unknown IDs", async () => {
    const memberId = await createMember("Empty history", null);
    expect(await getMemberHistory(memberId)).toEqual({
      member: { id: memberId, name: "Empty history", birthYear: null },
      accounts: [],
      stats: emptyStats,
      games: [],
      championStats: [],
      positionStats: [],
    });
    const [account] = await db
      .insert(riotAccounts)
      .values({
        memberId,
        gameName: "Account without games",
        tagLine: "KR1",
        puuid: "unused-account",
      })
      .returning({ id: riotAccounts.id });
    const linkedWithoutGames = await getMemberHistory(memberId);
    expect(linkedWithoutGames?.accounts).toEqual([
      { id: account.id, gameName: "Account without games", tagLine: "KR1" },
    ]);
    expect(linkedWithoutGames?.stats).toEqual(emptyStats);
    expect(linkedWithoutGames?.games).toEqual([]);
    for (const id of ["", "invalid-uuid", randomUUID()]) {
      expect(await getMemberHistory(id)).toBeNull();
    }
  });
});
