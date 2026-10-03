type Json = Record<string, unknown>;

export function replayPlayer(overrides: Json = {}): Json {
  return {
    RIOT_ID_GAME_NAME: "Player1",
    RIOT_ID_TAG_LINE: "KR1",
    PUUID: "puuid-1",
    SKIN: "Ahri",
    TEAM: "100",
    WIN: "Win",
    TEAM_POSITION: "MIDDLE",
    CHAMPIONS_KILLED: "10",
    NUM_DEATHS: "2",
    ASSISTS: "7",
    GOLD_EARNED: "15000",
    ...overrides,
  };
}

export function tenReplayPlayers(): Json[] {
  const positions = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
  return Array.from({ length: 10 }, (_, index) =>
    replayPlayer({
      RIOT_ID_GAME_NAME: `Player${index + 1}`,
      PUUID: `puuid-${index + 1}`,
      TEAM: index < 5 ? "100" : "200",
      WIN: index < 5 ? "Win" : "Fail",
      TEAM_POSITION: positions[index % 5],
    }),
  );
}

/** Synthetic, format-correct fixtures exercise the real parser and DB writes. */
export function replayBytes({
  players = tenReplayPlayers(),
  format = "legacy",
  metadata = {},
}: {
  players?: Json[];
  format?: "legacy" | "rofl2";
  metadata?: Json;
} = {}): Uint8Array {
  const content = new TextEncoder().encode(
    JSON.stringify({
      gameLength: 1834567,
      gameVersion: "14.23.1.1",
      lastGameChunkId: 10,
      lastKeyFrameId: 5,
      statsJson: JSON.stringify(players),
      ...metadata,
    }),
  );
  const offset = format === "legacy" ? 288 : 16;
  const bytes = new Uint8Array(
    offset + content.length + (format === "rofl2" ? 4 : 0),
  );
  bytes.set([0x52, 0x49, 0x4f, 0x54, format === "legacy" ? 0x00 : 0x02, 0x00]);
  bytes.set(content, offset);
  const view = new DataView(bytes.buffer);
  if (format === "legacy") {
    view.setUint16(262, offset, true);
    view.setUint32(264, bytes.length, true);
    view.setUint32(268, offset, true);
    view.setUint32(272, content.length, true);
    view.setUint32(276, bytes.length, true);
    view.setUint32(284, bytes.length, true);
  } else {
    view.setUint32(bytes.length - 4, content.length, true);
  }
  return bytes;
}
