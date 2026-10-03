import { describe, expect, it } from "vitest";

import { REPLAY_INGEST_LIMITS } from "../limits";
import { parseRofl, RoflParseError } from "./parser";

const enc = new TextEncoder();
const LEGACY_HEADER_SIZE = 288;

type Json = Record<string, unknown>;

function player(overrides: Json = {}): Json {
  return {
    RIOT_ID_GAME_NAME: "Faker",
    RIOT_ID_TAG_LINE: "KR1",
    PUUID: "puuid-1",
    SKIN: "Ahri",
    TEAM: "100",
    WIN: "Win",
    TEAM_POSITION: "MIDDLE",
    INDIVIDUAL_POSITION: "MIDDLE",
    CHAMPIONS_KILLED: "10",
    NUM_DEATHS: "2",
    ASSISTS: "7",
    GOLD_EARNED: "15000",
    ...overrides,
  };
}

function metadata(players: Json[], extra: Json = {}): Json {
  return {
    gameLength: 1834567,
    gameVersion: "14.23.1.1",
    lastGameChunkId: 10,
    lastKeyFrameId: 5,
    statsJson: JSON.stringify(players),
    ...extra,
  };
}

/** Build a synthetic legacy .rofl (header offset-table format). */
function buildLegacy(meta: Json): Uint8Array {
  const metaBytes = enc.encode(JSON.stringify(meta));
  const total = LEGACY_HEADER_SIZE + metaBytes.length;
  const buf = new Uint8Array(total);
  buf.set([0x52, 0x49, 0x4f, 0x54, 0x00, 0x00], 0); // "RIOT" + 0x00 0x00
  const view = new DataView(buf.buffer);
  view.setUint16(262, LEGACY_HEADER_SIZE, true);
  view.setUint32(264, total, true);
  view.setUint32(268, LEGACY_HEADER_SIZE, true); // metadataOffset
  view.setUint32(272, metaBytes.length, true); // metadataLength
  view.setUint32(276, total, true);
  view.setUint32(280, 0, true);
  view.setUint32(284, total, true);
  buf.set(metaBytes, LEGACY_HEADER_SIZE);
  return buf;
}

/** Build a synthetic ROFL2 .rofl (metadata in an EOF length-footer). */
function buildRofl2(meta: Json, headerVersion?: string): Uint8Array {
  const metaBytes = enc.encode(JSON.stringify(meta));
  const versionBytes =
    headerVersion === undefined ? null : enc.encode(headerVersion);
  const prefix = versionBytes ? 15 + versionBytes.length : 16;
  const total = prefix + metaBytes.length + 4;
  const buf = new Uint8Array(total);
  buf.set([0x52, 0x49, 0x4f, 0x54, 0x02, 0x00], 0); // "RIOT" + 0x02 0x00
  if (versionBytes) {
    buf[14] = versionBytes.length;
    buf.set(versionBytes, 15);
  }
  buf.set(metaBytes, prefix);
  new DataView(buf.buffer).setUint32(total - 4, metaBytes.length, true);
  return buf;
}

const tenPlayers = (): Json[] => [
  ...["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"].map((pos, i) =>
    player({
      RIOT_ID_GAME_NAME: `Blue${i}`,
      TEAM: "100",
      WIN: "Win",
      TEAM_POSITION: pos,
      INDIVIDUAL_POSITION: pos,
    }),
  ),
  ...["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"].map((pos, i) =>
    player({
      RIOT_ID_GAME_NAME: `Red${i}`,
      TEAM: "200",
      WIN: "Fail",
      TEAM_POSITION: pos,
      INDIVIDUAL_POSITION: pos,
    }),
  ),
];

describe("parseRofl - happy path", () => {
  for (const [label, build] of [
    ["legacy", buildLegacy],
    ["rofl2", buildRofl2],
  ] as const) {
    it(`parses a ${label} replay with 10 participants`, () => {
      const game = parseRofl(build(metadata(tenPlayers())));
      expect(game.participants).toHaveLength(10);
      expect(game.durationMs).toBe(1834567);
      expect(game.gameVersion).toBe("14.23.1.1");
      expect(game.winningTeam).toBe(100);

      const first = game.participants[0];
      expect(first.riotGameName).toBe("Blue0");
      expect(first.riotTagLine).toBe("KR1");
      expect(first.champion).toBe("Ahri");
      expect(first.team).toBe(100);
      expect(first.position).toBe("TOP");
      expect(first.win).toBe(true);
      expect(first.kills).toBe(10);
      expect(first.deaths).toBe(2);
      expect(first.assists).toBe(7);
      expect(first.goldEarned).toBe(15000);

      const loser = game.participants.find((p) => p.team === 200)!;
      expect(loser.win).toBe(false);
    });
  }
});

describe("parseRofl - ROFL2 header version", () => {
  const withoutMetadataVersion = () =>
    metadata([player()], { gameVersion: undefined });

  it("reads the observed length-prefixed version when metadata has none", () => {
    const game = parseRofl(
      buildRofl2(withoutMetadataVersion(), "16.19.821.7343"),
    );
    expect(game.gameVersion).toBe("16.19.821.7343");
  });

  it("prefers an existing metadata version over the header", () => {
    const game = parseRofl(buildRofl2(metadata([player()]), "16.19.821.7343"));
    expect(game.gameVersion).toBe("14.23.1.1");
  });

  it("handles a replay view whose underlying buffer starts earlier", () => {
    const replay = buildRofl2(withoutMetadataVersion(), "16.19.821.7343");
    const buffer = new Uint8Array(replay.length + 23);
    buffer.set(replay, 23);
    expect(parseRofl(buffer.subarray(23)).gameVersion).toBe("16.19.821.7343");
  });

  it.each([
    undefined,
    "",
    "16.19",
    "16.19.x.7343",
    "16.19.821.7343\n",
    "１６.19.821.7343",
    `16.19.821.${"1".repeat(60)}`,
  ])(
    "keeps the version unknown for an absent or malformed header (%j)",
    (version) => {
      expect(
        parseRofl(buildRofl2(withoutMetadataVersion(), version)).gameVersion,
      ).toBeNull();
    },
  );

  it("does not read a declared header version across the metadata boundary", () => {
    const replay = buildRofl2(withoutMetadataVersion(), "16.19.821.7343");
    replay[14] += 1;
    expect(parseRofl(replay).gameVersion).toBeNull();
  });

  it("does not search payload or stats strings for a version", () => {
    const replay = buildRofl2(
      metadata([player({ NOTE: "16.19.821.7343" })], {
        gameVersion: undefined,
      }),
    );
    expect(parseRofl(replay).gameVersion).toBeNull();
  });

  it("does not apply the ROFL2 header layout to a legacy replay", () => {
    const replay = buildLegacy(withoutMetadataVersion());
    const version = enc.encode("16.19.821.7343");
    replay[14] = version.length;
    replay.set(version, 15);
    expect(parseRofl(replay).gameVersion).toBeNull();
  });
});

describe("parseRofl - field handling", () => {
  describe.each([
    "RIOT_ID_TAG_LINE",
    "TEAM_POSITION",
    "INDIVIDUAL_POSITION",
    "WIN",
  ])("invalid scalar field %s", (field) => {
    it.each<{ value: unknown }>([
      { value: {} },
      { value: [] },
      { value: ["Win"] },
      { value: { toString: null } },
      { value: { valueOf: null } },
      { value: { toString: null, valueOf: null } },
    ])("rejects structured values as RoflParseError ($value)", ({ value }) => {
      const replay = buildLegacy(
        metadata([player({ TEAM_POSITION: "", [field]: value })]),
      );
      expect(() => parseRofl(replay)).toThrow(RoflParseError);
    });
  });

  it.each([0, 123, true, false, null, undefined])(
    "preserves supported scalar coercion and optional defaults (%j)",
    (value) => {
      const game = parseRofl(
        buildRofl2(
          metadata([
            player({
              RIOT_ID_TAG_LINE: value,
              TEAM_POSITION: value,
              INDIVIDUAL_POSITION: value,
              WIN: value,
              TEAM: 100,
              CHAMPIONS_KILLED: 10,
            }),
          ]),
        ),
      );
      expect(game.participants[0]).toMatchObject({
        riotTagLine: value == null ? "" : String(value),
        position: null,
        win: false,
        team: 100,
        kills: 10,
      });
    },
  );

  it("derives winningTeam from the WIN field, not a hard-coded loser string", () => {
    const game = parseRofl(
      buildLegacy(
        metadata([
          player({ TEAM: "100", WIN: "Win" }),
          player({ TEAM: "200", WIN: "Lose" }), // not "Fail"
        ]),
      ),
    );
    expect(game.winningTeam).toBe(100);
    expect(game.participants[0].win).toBe(true);
    expect(game.participants[1].win).toBe(false);
  });

  it("treats WIN case-insensitively", () => {
    const game = parseRofl(
      buildLegacy(metadata([player({ WIN: "WIN" }), player({ WIN: "" })])),
    );
    expect(game.participants[0].win).toBe(true);
    expect(game.participants[1].win).toBe(false);
  });

  it("falls back to INDIVIDUAL_POSITION when TEAM_POSITION is empty", () => {
    const game = parseRofl(
      buildLegacy(
        metadata([
          player({ TEAM_POSITION: "", INDIVIDUAL_POSITION: "BOTTOM" }),
        ]),
      ),
    );
    expect(game.participants[0].position).toBe("BOTTOM");
  });

  it("records unknown position as null (empty + INVALID)", () => {
    const game = parseRofl(
      buildLegacy(
        metadata([
          player({ TEAM_POSITION: "", INDIVIDUAL_POSITION: "INVALID" }),
        ]),
      ),
    );
    expect(game.participants[0].position).toBeNull();
  });

  it("rejects invalid team values", () => {
    expect(() =>
      parseRofl(buildLegacy(metadata([player({ TEAM: "300" })]))),
    ).toThrow(/champion or team/);
  });

  it.each([undefined, "", {}, 123])(
    "rejects a missing or invalid champion (%j)",
    (skin) => {
      expect(() =>
        parseRofl(buildRofl2(metadata([player({ SKIN: skin })]))),
      ).toThrow(/champion or team/);
    },
  );

  it.each([undefined, 0, -1, 123.5, "123ms", 2_147_483_648])(
    "rejects a missing or invalid required duration (%j)",
    (gameLength) => {
      expect(() =>
        parseRofl(buildLegacy(metadata([player()], { gameLength }))),
      ).toThrow(/game duration/);
    },
  );

  it.each(["10kills", "2.5", 2.5, -1, 2_147_483_648, true, {}])(
    "does not store malformed optional counters (%j)",
    (counter) => {
      const game = parseRofl(
        buildLegacy(
          metadata([
            player({
              CHAMPIONS_KILLED: counter,
              NUM_DEATHS: counter,
              ASSISTS: counter,
              GOLD_EARNED: counter,
            }),
          ]),
        ),
      );
      expect(game.participants[0]).toMatchObject({
        kills: null,
        deaths: null,
        assists: null,
        goldEarned: null,
      });
    },
  );

  it("returns null winningTeam when no clear winner", () => {
    const game = parseRofl(
      buildLegacy(metadata([player({ WIN: "Fail", TEAM: "100" })])),
    );
    expect(game.winningTeam).toBeNull();
  });

  it("returns null winningTeam when only the winning team is present", () => {
    const game = parseRofl(
      buildLegacy(
        metadata([
          player({ TEAM: "100", WIN: "Win" }),
          player({ TEAM: "100", WIN: "Win" }),
        ]),
      ),
    );
    expect(game.winningTeam).toBeNull();
  });
});

describe("parseRofl - resource budgets (Codex finding #3)", () => {
  it("accepts exactly the supported maximum of 10 participants", () => {
    // Documents the boundary: normal 5v5 customs are the supported MVP shape,
    // and the happy-path suite above relies on this staying green.
    const game = parseRofl(buildLegacy(metadata(tenPlayers())));
    expect(game.participants).toHaveLength(10);
  });

  it("rejects a replay with 11 participants as unsupported", () => {
    const players = [...tenPlayers(), player({ RIOT_ID_GAME_NAME: "Extra" })];
    expect(() => parseRofl(buildLegacy(metadata(players)))).toThrow(
      /11 participants.*maximum is 10/,
    );
  });

  it("rejects a 20,000-participant PoC without returning any participants", () => {
    // Shape of the scan's PoC: a file far under the byte cap whose statsJson
    // fans out to thousands of entries. It must die in the parser (here on the
    // statsJson size budget; the count budget backstops smaller fanouts), so
    // ingestion can never even start a transaction for it.
    const players = Array.from({ length: 20_000 }, (_, i) => ({
      RIOT_ID_GAME_NAME: `P${i}`,
      TEAM: "100",
      WIN: "Win",
    }));
    expect(() => parseRofl(buildRofl2(metadata(players)))).toThrow(
      RoflParseError,
    );
  });

  it("rejects statsJson over the configured byte budget", () => {
    const limits = { ...REPLAY_INGEST_LIMITS, maxStatsJsonBytes: 64 };
    expect(() =>
      parseRofl(buildLegacy(metadata(tenPlayers())), limits),
    ).toThrow(/stats exceed the supported size/);
  });

  it("rejects metadata over the configured byte budget", () => {
    const limits = { ...REPLAY_INGEST_LIMITS, maxMetadataBytes: 64 };
    expect(() =>
      parseRofl(buildLegacy(metadata(tenPlayers())), limits),
    ).toThrow(/metadata section exceeds/);
  });

  it("rejects a single participant object over the size budget", () => {
    const limits = { ...REPLAY_INGEST_LIMITS, maxParticipantJsonBytes: 128 };
    const bloated = player({ NOTE: "x".repeat(500) });
    expect(() =>
      parseRofl(buildLegacy(metadata([player(), bloated])), limits),
    ).toThrow(/participant stats object exceeds/);
  });

  it("rejects participant stats nested deeper than the budget", () => {
    // 6 levels of nesting vs the default budget of 4.
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    expect(() =>
      parseRofl(buildLegacy(metadata([player({ EXTRA: deep })]))),
    ).toThrow(/nested too deeply/);
  });

  it("counts UTF-8 bytes for Korean participant payloads", () => {
    const entry = player({ NOTE: "가".repeat(100) });
    const limits = {
      ...REPLAY_INGEST_LIMITS,
      maxParticipantJsonBytes: JSON.stringify(entry).length + 1,
    };
    expect(() => parseRofl(buildRofl2(metadata([entry])), limits)).toThrow(
      /participant stats object exceeds/,
    );
  });

  it("rejects a non-object participant entry", () => {
    const meta = metadata([]);
    meta.statsJson = JSON.stringify([player(), 42]);
    expect(() => parseRofl(buildLegacy(meta))).toThrow(/not an object/);
  });

  it("bounds retained raw stats to allowlisted scalars", () => {
    const game = parseRofl(
      buildLegacy(
        metadata([
          player({
            UNKNOWN_FIELD: "dropped",
            NESTED: { deep: true },
            LONG: "x".repeat(REPLAY_INGEST_LIMITS.maxRawValueChars + 1),
            VISION_SCORE: 42,
          }),
        ]),
      ),
    );
    const raw = game.participants[0].raw;
    expect(raw.RIOT_ID_GAME_NAME).toBe("Faker");
    expect(raw.PUUID).toBe("puuid-1");
    expect(raw.VISION_SCORE).toBe(42);
    expect(raw).not.toHaveProperty("UNKNOWN_FIELD");
    expect(raw).not.toHaveProperty("NESTED");
    expect(raw).not.toHaveProperty("LONG");
  });

  it("bounds retained metadata to allowlisted scalar fields", () => {
    const game = parseRofl(
      buildLegacy(metadata(tenPlayers(), { ARBITRARY: { big: "blob" } })),
    );
    expect(game.rawMetadata).toEqual({
      gameLength: 1834567,
      gameVersion: "14.23.1.1",
      lastGameChunkId: 10,
      lastKeyFrameId: 5,
    });
  });
});

describe("parseRofl - errors", () => {
  it("rejects a file with bad magic", () => {
    const buf = new Uint8Array(300);
    buf.set([0x4e, 0x4f, 0x50, 0x45], 0);
    expect(() => parseRofl(buf)).toThrow(RoflParseError);
  });

  it("rejects an unsupported version byte", () => {
    const buf = buildLegacy(metadata([player()]));
    buf[4] = 0x09;
    expect(() => parseRofl(buf)).toThrow(/version byte/);
  });

  it("rejects empty statsJson (patch-13.20-era replays)", () => {
    expect(() => parseRofl(buildLegacy(metadata([])))).toThrow(
      /no participant stats/,
    );
    expect(() =>
      parseRofl(buildRofl2(metadata([], { statsJson: "[]" }))),
    ).toThrow(/no participant stats/);
  });

  it("rejects a participant with no Riot ID", () => {
    expect(() =>
      parseRofl(buildLegacy(metadata([player({ RIOT_ID_GAME_NAME: "" })]))),
    ).toThrow(/Riot ID/);
  });

  it("rejects an out-of-range legacy metadata offset", () => {
    const buf = buildLegacy(metadata([player()]));
    new DataView(buf.buffer).setUint32(272, 0xffffffff, true); // bogus length
    expect(() => parseRofl(buf)).toThrow(RoflParseError);
  });

  it("rejects object values in required identity fields", () => {
    expect(() =>
      parseRofl(
        buildLegacy(
          metadata([player({ RIOT_ID_GAME_NAME: { name: "Faker" } })]),
        ),
      ),
    ).toThrow(/Riot ID/);
  });

  it("rejects malformed UTF-8 instead of storing replacement characters", () => {
    const bytes = buildLegacy(metadata([player()]));
    const nameIndex = Buffer.from(bytes).indexOf("Faker");
    bytes[nameIndex] = 0xff;
    expect(() => parseRofl(bytes)).toThrow(/decode replay metadata/);
  });
});
