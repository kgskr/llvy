/**
 * Parser for League of Legends .rofl replay files.
 *
 * Supports both container formats (magic "RIOT" + a version byte):
 *   - legacy ROFL  (byte 4 == 0x00): metadata located via the 288-byte header's
 *     offset table.
 *   - ROFL2        (byte 4 == 0x02): metadata located via a 4-byte little-endian
 *     length footer at end-of-file.
 *
 * In both formats the metadata is plain UTF-8 JSON (no compression). The
 * metadata object's `statsJson` is itself a JSON-encoded STRING that must be
 * parsed a second time to get the per-player array.
 *
 * Field names are documented in the change's design.md.
 *
 * Resource budgets: the file-size cap alone does not bound parser CPU, DB rows,
 * or JSONB storage (a small file can carry a huge statsJson fanout), so this
 * module enforces semantic limits — metadata size, statsJson size, participant
 * count/object size/nesting depth — and reduces retained raw JSON to a bounded
 * scalar allowlist. Budgets are injectable for tests; defaults live in
 * `REPLAY_INGEST_LIMITS`.
 */

import { REPLAY_INGEST_LIMITS, type ReplayIngestLimits } from "../limits";

/** Thrown for files that are not parseable, carry no usable participant stats,
 * or exceed the supported replay shape/budgets. */
export class RoflParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoflParseError";
  }
}

export type Position = "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY";

export interface ParsedParticipant {
  riotGameName: string;
  riotTagLine: string;
  puuid: string | null;
  champion: string | null;
  team: number | null;
  position: Position | null;
  win: boolean;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  goldEarned: number | null;
  /** Bounded diagnostic subset of the stats object (allowlisted scalars only). */
  raw: Record<string, unknown>;
}

export interface ParsedGame {
  durationMs: number | null;
  gameVersion: string | null;
  winningTeam: number | null;
  participants: ParsedParticipant[];
  /** Bounded diagnostic subset of the metadata (allowlisted scalars only). */
  rawMetadata: Record<string, unknown>;
}

const MAGIC = [0x52, 0x49, 0x4f, 0x54]; // "RIOT"
const LEGACY_HEADER_SIZE = 288;
const ROFL2_VERSION_LENGTH_OFFSET = 14;
const ROFL2_VERSION_OFFSET = 15;
const MAX_HEADER_VERSION_BYTES = 64;
const POSITIONS: ReadonlySet<string> = new Set([
  "TOP",
  "JUNGLE",
  "MIDDLE",
  "BOTTOM",
  "UTILITY",
]);

/**
 * Scalar stats retained per participant for diagnostics and future features
 * (builds, damage charts). Everything else in the replay-controlled stats
 * object — unknown keys, nested values, oversized strings — is dropped before
 * storage. Keys absent from a replay are simply skipped.
 */
const RAW_STAT_ALLOWLIST: readonly string[] = [
  // Identity / game shape
  "ID",
  "NAME",
  "SUMMONER_NAME",
  "RIOT_ID_GAME_NAME",
  "RIOT_ID_TAG_LINE",
  "PUUID",
  "SKIN",
  "TEAM",
  "TEAM_POSITION",
  "INDIVIDUAL_POSITION",
  "WIN",
  "LEVEL",
  "EXP",
  "TIME_PLAYED",
  // Combat
  "CHAMPIONS_KILLED",
  "NUM_DEATHS",
  "ASSISTS",
  "LARGEST_KILLING_SPREE",
  "LARGEST_MULTI_KILL",
  "DOUBLE_KILLS",
  "TRIPLE_KILLS",
  "QUADRA_KILLS",
  "PENTA_KILLS",
  "TOTAL_DAMAGE_DEALT_TO_CHAMPIONS",
  "TOTAL_DAMAGE_TAKEN",
  "TOTAL_HEAL",
  "TIME_CCING_OTHERS",
  "TOTAL_TIME_CROWD_CONTROL_DEALT",
  "TOTAL_TIME_SPENT_DEAD",
  // Economy
  "GOLD_EARNED",
  "GOLD_SPENT",
  "MINIONS_KILLED",
  "NEUTRAL_MINIONS_KILLED",
  // Vision
  "VISION_SCORE",
  "WARD_PLACED",
  "WARD_KILLED",
  "VISION_WARDS_BOUGHT_IN_GAME",
  // Objectives
  "TURRETS_KILLED",
  "BARRACKS_KILLED",
  "DRAGON_KILLS",
  "BARON_KILLS",
  "RIFT_HERALD_KILLS",
  "OBJECTIVES_STOLEN",
  // Build
  "ITEM0",
  "ITEM1",
  "ITEM2",
  "ITEM3",
  "ITEM4",
  "ITEM5",
  "ITEM6",
  "KEYSTONE_ID",
  "PERK_PRIMARY_STYLE",
  "PERK_SUB_STYLE",
  // Meta
  "GAME_ENDED_IN_SURRENDER",
  "GAME_ENDED_IN_EARLY_SURRENDER",
  "WAS_AFK",
  "PING",
];

/** Scalar metadata fields worth keeping (these are the only known top-level
 * keys besides statsJson, which is stored normalized in participants). */
const METADATA_ALLOWLIST: readonly string[] = [
  "gameLength",
  "gameVersion",
  "lastGameChunkId",
  "lastKeyFrameId",
];

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function detectFormat(bytes: Uint8Array): "legacy" | "rofl2" {
  if (bytes.length < 6) {
    throw new RoflParseError("File is too small to be a .rofl replay.");
  }
  for (let i = 0; i < MAGIC.length; i += 1) {
    if (bytes[i] !== MAGIC[i]) {
      throw new RoflParseError("Not a .rofl file (bad magic bytes).");
    }
  }
  const versionByte = bytes[4];
  if (versionByte === 0x02) return "rofl2";
  if (versionByte === 0x00) return "legacy";
  throw new RoflParseError(
    `Unsupported .rofl version byte: 0x${versionByte.toString(16)}.`,
  );
}

function extractMetadataBytes(
  bytes: Uint8Array,
  format: "legacy" | "rofl2",
): Uint8Array {
  const view = viewOf(bytes);
  const fileSize = bytes.length;

  if (format === "legacy") {
    if (fileSize < LEGACY_HEADER_SIZE) {
      throw new RoflParseError("Truncated legacy .rofl header.");
    }
    const metadataOffset = view.getUint32(268, true);
    const metadataLength = view.getUint32(272, true);
    const end = metadataOffset + metadataLength;
    if (
      metadataOffset < LEGACY_HEADER_SIZE ||
      metadataLength === 0 ||
      end > fileSize
    ) {
      throw new RoflParseError("Invalid legacy metadata offset/length.");
    }
    return bytes.subarray(metadataOffset, end);
  }

  // ROFL2: metadata length is the last 4 bytes; metadata precedes that footer.
  if (fileSize < 8) {
    throw new RoflParseError("Truncated ROFL2 file.");
  }
  const metadataLength = view.getUint32(fileSize - 4, true);
  const metadataStart = fileSize - metadataLength - 4;
  if (metadataLength === 0 || metadataStart < 6) {
    throw new RoflParseError("Invalid ROFL2 metadata length.");
  }
  return bytes.subarray(metadataStart, fileSize - 4);
}

/**
 * ROFL2's version is a length-prefixed ASCII field, often absent from metadata.
 * Layout: u8 length at 0x0e, then major.minor.build.revision at 0x0f.
 * Evidence: the ROFL-X project's independently observed format notes and our
 * supplied 16.19.821.7343 replay agree on these offsets. This is not an official
 * Riot format guarantee, so unknown/malformed headers leave the version null.
 * https://github.com/Toastaspiring/ROFL-X/blob/main/docs/ROFL_FORMAT.md#section-a-fileheader
 */
function extractRofl2GameVersion(
  bytes: Uint8Array,
  metadataOffset: number,
): string | null {
  if (metadataOffset < ROFL2_VERSION_OFFSET) return null;
  const length = bytes[ROFL2_VERSION_LENGTH_OFFSET];
  const end = ROFL2_VERSION_OFFSET + length;
  if (length < 7 || length > MAX_HEADER_VERSION_BYTES || end > metadataOffset) {
    return null;
  }
  const versionBytes = bytes.subarray(ROFL2_VERSION_OFFSET, end);
  for (const byte of versionBytes) {
    if (byte !== 0x2e && (byte < 0x30 || byte > 0x39)) return null;
  }
  const version = String.fromCharCode(...versionBytes);
  return /^[0-9]+(?:\.[0-9]+){3}$/.test(version) ? version : null;
}

function asString(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    throw new RoflParseError(
      "Unsupported replay: participant text fields must contain scalar values.",
    );
  }
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function nonEmpty(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : null;
}

function toInt(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  // These values are non-negative counters stored in PostgreSQL int4 columns.
  return Number.isInteger(n) && n >= 0 && n <= 2_147_483_647 ? n : null;
}

function parseTeam(value: unknown): number | null {
  const n = toInt(value);
  return n === 100 || n === 200 ? n : null;
}

function parsePosition(team: unknown, individual: unknown): Position | null {
  const primary = asString(team).trim().toUpperCase();
  if (POSITIONS.has(primary)) return primary as Position;
  const fallback = asString(individual).trim().toUpperCase();
  if (POSITIONS.has(fallback)) return fallback as Position;
  return null;
}

function isWin(value: unknown): boolean {
  return asString(value).trim().toLowerCase() === "win";
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** True when `value` contains an object/array nested deeper than `remaining`
 * levels (the value itself counts as one level when it is an object). Bails on
 * the first offender, and recursion depth is capped by the budget itself. */
function exceedsDepth(value: unknown, remaining: number): boolean {
  if (value === null || typeof value !== "object") return false;
  if (remaining <= 0) return true;
  const children = Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>);
  return children.some((child) => exceedsDepth(child, remaining - 1));
}

function parseMetadata(
  metadataBytes: Uint8Array,
  limits: ReplayIngestLimits,
): Record<string, unknown> {
  if (metadataBytes.length > limits.maxMetadataBytes) {
    throw new RoflParseError(
      "Unsupported replay: metadata section exceeds the supported size.",
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(metadataBytes);
  } catch {
    throw new RoflParseError("Could not decode replay metadata.");
  }
  let metadata: unknown;
  try {
    metadata = JSON.parse(text);
  } catch {
    throw new RoflParseError("Replay metadata is not valid JSON.");
  }
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata)
  ) {
    throw new RoflParseError("Replay metadata is not an object.");
  }
  return metadata as Record<string, unknown>;
}

function parseStats(
  metadata: Record<string, unknown>,
  limits: ReplayIngestLimits,
): Record<string, unknown>[] {
  const raw = metadata.statsJson;
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") {
    throw new RoflParseError(
      "Replay contains no participant stats (empty statsJson).",
    );
  }
  // Budget BEFORE JSON.parse so over-budget input never pays parse cost. The
  // code-unit check is a cheap upper-bound filter (units never exceed UTF-8
  // bytes); the exact byte check then allocates at most ~3x the budget.
  if (
    text.length > limits.maxStatsJsonBytes ||
    utf8ByteLength(text) > limits.maxStatsJsonBytes
  ) {
    throw new RoflParseError(
      "Unsupported replay: participant stats exceed the supported size.",
    );
  }
  let stats: unknown;
  try {
    stats = JSON.parse(text);
  } catch {
    throw new RoflParseError("statsJson is not valid JSON.");
  }
  if (!Array.isArray(stats) || stats.length === 0) {
    throw new RoflParseError(
      "Replay contains no participant stats (empty statsJson).",
    );
  }
  if (stats.length > limits.maxParticipants) {
    throw new RoflParseError(
      `Unsupported replay: ${stats.length} participants ` +
        `(supported maximum is ${limits.maxParticipants}).`,
    );
  }
  for (const entry of stats) {
    assertParticipantEntryWithinBudget(entry, limits);
  }
  return stats as Record<string, unknown>[];
}

function assertParticipantEntryWithinBudget(
  entry: unknown,
  limits: ReplayIngestLimits,
): void {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    throw new RoflParseError(
      "Unsupported replay: participant stats entry is not an object.",
    );
  }
  // Serialization cost is bounded by the statsJson size budget checked above.
  if (utf8ByteLength(JSON.stringify(entry)) > limits.maxParticipantJsonBytes) {
    throw new RoflParseError(
      "Unsupported replay: a participant stats object exceeds the supported size.",
    );
  }
  if (exceedsDepth(entry, limits.maxParticipantDepth)) {
    throw new RoflParseError(
      "Unsupported replay: participant stats are nested too deeply.",
    );
  }
}

/** Reduce a replay-controlled object to allowlisted, size-capped scalars. */
function boundToAllowlist(
  source: Record<string, unknown>,
  allowlist: readonly string[],
  maxValueChars: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of allowlist) {
    if (!(key in source)) continue;
    const value = source[key];
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "string" && value.length <= maxValueChars) {
      out[key] = value;
    }
    // Oversized strings and non-scalars are omitted, not truncated: the
    // retained shape stays bounded and unambiguous.
  }
  return out;
}

function toParticipant(
  raw: Record<string, unknown>,
  limits: ReplayIngestLimits,
): ParsedParticipant {
  const riotGameName = nonEmpty(raw.RIOT_ID_GAME_NAME);
  if (!riotGameName) {
    throw new RoflParseError(
      "Participant is missing a Riot ID (RIOT_ID_GAME_NAME).",
    );
  }
  const champion = nonEmpty(raw.SKIN);
  const team = parseTeam(raw.TEAM);
  if (!champion || team === null) {
    throw new RoflParseError(
      "Unsupported replay: participant is missing a valid champion or team.",
    );
  }
  return {
    riotGameName,
    riotTagLine: asString(raw.RIOT_ID_TAG_LINE).trim(),
    puuid: nonEmpty(raw.PUUID),
    champion,
    team,
    position: parsePosition(raw.TEAM_POSITION, raw.INDIVIDUAL_POSITION),
    win: isWin(raw.WIN),
    kills: toInt(raw.CHAMPIONS_KILLED),
    deaths: toInt(raw.NUM_DEATHS),
    assists: toInt(raw.ASSISTS),
    goldEarned: toInt(raw.GOLD_EARNED),
    raw: boundToAllowlist(raw, RAW_STAT_ALLOWLIST, limits.maxRawValueChars),
  };
}

function deriveWinningTeam(participants: ParsedParticipant[]): number | null {
  const winningTeams = new Set(
    participants.filter((p) => p.win && p.team != null).map((p) => p.team),
  );
  if (winningTeams.size !== 1) return null;
  const winner = [...winningTeams][0]!;
  // Require a losing opponent to be present, so a partial/corrupt file with only
  // one team's winners doesn't assert a winner unverified.
  const hasOpponent = participants.some(
    (p) => p.team != null && p.team !== winner,
  );
  return hasOpponent ? winner : null;
}

/** Parse a .rofl file's bytes into a normalized game + participants, enforcing
 * the given resource budgets (defaults: `REPLAY_INGEST_LIMITS`). */
export function parseRofl(
  bytes: Uint8Array,
  limits: ReplayIngestLimits = REPLAY_INGEST_LIMITS,
): ParsedGame {
  const format = detectFormat(bytes);
  const metadataBytes = extractMetadataBytes(bytes, format);
  const metadata = parseMetadata(metadataBytes, limits);
  const durationMs = toInt(metadata.gameLength);
  if (durationMs === null || durationMs === 0) {
    throw new RoflParseError(
      "Unsupported replay: missing or invalid game duration.",
    );
  }
  const stats = parseStats(metadata, limits);
  const participants = stats.map((entry) => toParticipant(entry, limits));

  return {
    durationMs,
    gameVersion:
      nonEmpty(metadata.gameVersion) ??
      (format === "rofl2"
        ? extractRofl2GameVersion(
            bytes,
            metadataBytes.byteOffset - bytes.byteOffset,
          )
        : null),
    winningTeam: deriveWinningTeam(participants),
    participants,
    rawMetadata: boundToAllowlist(
      metadata,
      METADATA_ALLOWLIST,
      limits.maxRawValueChars,
    ),
  };
}
