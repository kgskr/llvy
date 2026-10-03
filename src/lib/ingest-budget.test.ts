import { describe, expect, it } from "vitest";

import { assertWithinIngestBudget } from "./ingest-budget";
import { REPLAY_INGEST_LIMITS } from "./limits";
import { RoflParseError, type ParsedParticipant } from "./rofl/parser";

function participant(
  overrides: Partial<ParsedParticipant> = {},
): ParsedParticipant {
  return {
    riotGameName: "Faker",
    riotTagLine: "KR1",
    puuid: "puuid-1",
    champion: "Ahri",
    team: 100,
    position: "MIDDLE",
    win: true,
    kills: 10,
    deaths: 2,
    assists: 7,
    goldEarned: 15000,
    raw: { RIOT_ID_GAME_NAME: "Faker", VISION_SCORE: 42 },
    ...overrides,
  };
}

// ingestReplay() calls this gate after parsing and BEFORE db.transaction(), so
// a throw here means no game/account/participant write can have happened.
describe("assertWithinIngestBudget", () => {
  it("passes a normal 10-participant game", () => {
    const participants = Array.from({ length: 10 }, () => participant());
    expect(() => assertWithinIngestBudget(participants)).not.toThrow();
  });

  it("rejects more participant rows than the budget before any DB work", () => {
    const participants = Array.from({ length: 11 }, () => participant());
    expect(() => assertWithinIngestBudget(participants)).toThrow(
      RoflParseError,
    );
    expect(() => assertWithinIngestBudget(participants)).toThrow(
      /11 participants/,
    );
  });

  it("rejects raw stats over the storage budget", () => {
    const limits = { ...REPLAY_INGEST_LIMITS, maxParticipantJsonBytes: 64 };
    const bloated = participant({ raw: { NOTE: "x".repeat(200) } });
    expect(() => assertWithinIngestBudget([bloated], limits)).toThrow(
      /storage budget/,
    );
  });

  it("enforces the storage budget in UTF-8 bytes, not character count", () => {
    const raw = { RIOT_ID_GAME_NAME: "가".repeat(30) };
    const limits = {
      ...REPLAY_INGEST_LIMITS,
      maxParticipantJsonBytes: JSON.stringify(raw).length + 1,
    };
    expect(() =>
      assertWithinIngestBudget([participant({ raw })], limits),
    ).toThrow(/storage budget/);
  });
});
