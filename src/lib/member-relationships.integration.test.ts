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
import {
  client,
  migrateTestDatabase,
  resetTestDatabase,
} from "@/test/database";
import {
  relationshipGameFixture as game,
  relationshipMemberFixture as member,
} from "@/test/member-relationships";

vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => ({ db: (await import("@/test/database")).db }));

import { getMemberRelationshipHighlights as highlights } from "./member-relationships";
import { getMemberHistory } from "./member-history";

beforeAll(migrateTestDatabase, 30_000);
beforeEach(() => resetTestDatabase());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(() => client.close());

describe("member relationship highlights", () => {
  it("applies three-game thresholds separately, combines both members' accounts, and ignores pagination", async () => {
    const own = await member("기준");
    const peer = await member("친구");
    const play = (team: number, winner: number | null, alternate = 0) =>
      game(
        [
          { account: own.accounts[alternate], team: 100 },
          { account: peer.accounts[alternate], team },
        ],
        winner,
      );
    await play(100, 100);
    await play(100, 200, 1);
    await play(200, 100);
    expect(await highlights(own.id)).toEqual([]);
    await play(100, 100);
    expect((await highlights(own.id)).map((entry) => entry.kind)).toEqual([
      "allyWinRate",
      "allyGames",
    ]);
    await play(200, 200, 1);
    await play(200, null);
    const query = vi.spyOn(client, "query");
    const result = await highlights(own.id);
    expect(query).toHaveBeenCalledOnce();
    expect(result).toEqual([
      {
        kind: "allyWinRate",
        memberId: peer.id,
        memberName: "친구",
        totalGames: 3,
        wins: 2,
        losses: 1,
        undecided: 0,
        winRate: 200 / 3,
      },
      {
        kind: "opponentWinRate",
        memberId: peer.id,
        memberName: "친구",
        totalGames: 3,
        wins: 1,
        losses: 1,
        undecided: 1,
        winRate: 50,
      },
      {
        kind: "allyGames",
        memberId: peer.id,
        memberName: "친구",
        totalGames: 3,
        wins: 2,
        losses: 1,
        undecided: 0,
        winRate: 200 / 3,
      },
      {
        kind: "opponentGames",
        memberId: peer.id,
        memberName: "친구",
        totalGames: 3,
        wins: 1,
        losses: 1,
        undecided: 1,
        winRate: 50,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /birthYear|PUUID|private-fixture|rawStats|gameName|tagLine/,
    );
    expect((await getMemberHistory(own.id, 1, 0))?.relationshipStats).toEqual(
      result,
    );
    expect((await getMemberHistory(own.id, 1, 100))?.relationshipStats).toEqual(
      result,
    );
    const reverse = (await highlights(peer.id)).find(
      (entry) => entry.kind === "opponentWinRate",
    );
    expect(reverse).toMatchObject({
      memberId: own.id,
      wins: 1,
      losses: 1,
      undecided: 1,
      winRate: 50,
    });
  });

  it.each([
    "excluded",
    "own-duplicate-same",
    "own-duplicate-opposite",
    "own-duplicate-null",
    "peer-duplicate-same",
    "peer-duplicate-opposite",
    "peer-duplicate-null",
    "own-null",
    "peer-null",
    "own-invalid",
    "peer-invalid",
  ])(
    "omits %s participation before admitting a third game",
    async (variant) => {
      const own = await member("기준");
      const peer = await member("친구");
      const players = [
        { account: own.accounts[0], team: 100 as number | null },
        { account: peer.accounts[0], team: 100 as number | null },
      ];
      await game(players);
      await game(players);
      if (variant.includes("duplicate"))
        players.push({
          account: variant.startsWith("own")
            ? own.accounts[1]
            : peer.accounts[1],
          team: variant.endsWith("null")
            ? null
            : variant.endsWith("opposite")
              ? 200
              : 100,
        });
      else if (variant !== "excluded")
        players[variant.startsWith("own") ? 0 : 1].team = variant.endsWith(
          "null",
        )
          ? null
          : 300;
      await game(players, 100, variant === "excluded");
      expect(await highlights(own.id)).toEqual([]);
    },
  );

  it("selects distinct winners for rate and frequency in each relationship from the viewed member's perspective", async () => {
    const own = await member("기준");
    const candidates = [];
    for (const team of [100, 200]) {
      for (const count of [3, 5]) {
        const peer = await member(`후보${team}-${count}`);
        candidates.push(peer);
        for (let index = 0; index < count; index++)
          await game(
            [
              { account: own.accounts[index % 2], team: 100 },
              { account: peer.accounts[index % 2], team },
            ],
            index < 3 ? 100 : 200,
          );
      }
    }
    const result = await highlights(own.id);
    expect(
      result.map((entry) => [
        entry.kind,
        entry.memberId,
        entry.totalGames,
        entry.winRate,
      ]),
    ).toEqual([
      ["allyWinRate", candidates[0].id, 3, 100],
      ["opponentWinRate", candidates[2].id, 3, 100],
      ["allyGames", candidates[1].id, 5, 60],
      ["opponentGames", candidates[3].id, 5, 60],
    ]);
    expect(
      (await highlights(candidates[2].id)).find(
        (entry) => entry.kind === "opponentWinRate",
      ),
    ).toMatchObject({ memberId: own.id, winRate: 0, wins: 0, losses: 3 });
  });

  it("keeps all-undecided meetings for frequency only", async () => {
    const own = await member("기준");
    const peer = await member("친구");
    for (const winner of [null, 0, 300])
      await game(
        [
          { account: own.accounts[0], team: 100 },
          { account: peer.accounts[0], team: 200 },
        ],
        winner,
      );
    expect(await highlights(own.id)).toEqual([
      {
        kind: "opponentGames",
        memberId: peer.id,
        memberName: "친구",
        totalGames: 3,
        wins: 0,
        losses: 0,
        undecided: 3,
        winRate: null,
      },
    ]);
  });

  it("breaks equal rates by decided games before total games and UUID, without rounding", async () => {
    const own = await member("기준");
    const short = await member("짧은 표본");
    const long = await member("긴 표본");
    const tied = await member("동률");
    for (const [peer, outcomes] of [
      [short, [100, 100, 100, null, null]],
      [long, [100, 100, 100, 100]],
      [tied, [100, 100, 100, 100]],
    ] as const) {
      for (const winner of outcomes)
        await game(
          [
            { account: own.accounts[0], team: 100 },
            { account: peer.accounts[0], team: 100 },
          ],
          winner,
        );
    }
    const result = await highlights(own.id);
    expect(result.find((entry) => entry.kind === "allyWinRate")?.memberId).toBe(
      [long.id, tied.id].sort()[0],
    );
    expect(result.find((entry) => entry.kind === "allyGames")?.memberId).toBe(
      short.id,
    );
  });

  it("returns no candidates for an empty or unknown member", async () => {
    expect(await highlights((await member("빈 전적")).id)).toEqual([]);
    expect(await highlights(randomUUID())).toEqual([]);
  });
});
