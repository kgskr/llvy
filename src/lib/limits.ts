/**
 * Central security limits and ingestion budgets.
 *
 * Exported as defaults and accepted as injectable parameters by the enforcing
 * modules (login throttle, .rofl parser, ingest) so tests can drive small
 * budgets without building huge fixtures. No secrets here — safe to import
 * from tests and edge code.
 */

/** Failed-login throttling (fixed window, pre-auth). */
export type LoginThrottleLimits = {
  /**
   * Attempts allowed per client hint per window. The hint comes from forwarded
   * headers, which are attacker-controlled, so this bucket is best-effort only.
   */
  perClientAttempts: number;
  /**
   * Attempts allowed across ALL clients per window. This bucket is keyed by a
   * constant, so rotating forwarded headers cannot escape it. Sized for a small
   * club: a burst of typos won't hit it, a brute force will.
   */
  globalAttempts: number;
  windowMs: number;
};

export const LOGIN_THROTTLE_LIMITS: LoginThrottleLimits = {
  perClientAttempts: 10,
  globalAttempts: 30,
  windowMs: 60_000,
};

/**
 * Budgets applied to replay metadata during parsing and ingestion. These bound
 * parser CPU, transaction row counts, and JSONB storage independently of the
 * raw file-size cap (a small file can still carry a huge statsJson fanout).
 */
export type ReplayIngestLimits = {
  /** Supported MVP game shape is a normal custom game: at most 10 players. */
  maxParticipants: number;
  /** Whole decoded metadata JSON section of the .rofl. */
  maxMetadataBytes: number;
  /** The nested statsJson string (dominates metadata size in real replays). */
  maxStatsJsonBytes: number;
  /** One participant's serialized stats object. */
  maxParticipantJsonBytes: number;
  /** Nesting depth allowed inside one participant's stats object. */
  maxParticipantDepth: number;
  /** Longest string value retained in bounded diagnostic raw stats. */
  maxRawValueChars: number;
};

// Real 10-player replays carry ~40KB of statsJson with flat (depth-1)
// participant objects; each cap leaves generous headroom over that.
export const REPLAY_INGEST_LIMITS: ReplayIngestLimits = {
  maxParticipants: 10,
  maxMetadataBytes: 4 * 1024 * 1024,
  maxStatsJsonBytes: 256 * 1024,
  maxParticipantJsonBytes: 32 * 1024,
  maxParticipantDepth: 4,
  maxRawValueChars: 256,
};

/** Upload size cap shared by the Blob token route and the process route. */
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

/**
 * A pending-upload binding must be consumed (processed) within this window;
 * afterwards /api/process rejects it and the row is swept opportunistically.
 */
export const PENDING_UPLOAD_TTL_MS = 30 * 60 * 1000;
