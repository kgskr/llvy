import { REPLAY_INGEST_LIMITS, type ReplayIngestLimits } from "./limits";
import { RoflParseError, type ParsedParticipant } from "./rofl/parser";

/**
 * Re-validate parser output against DB work budgets immediately before the
 * ingest transaction opens. The parser already enforces these limits on its
 * input; this second gate guards against parser drift so an over-budget replay
 * can never reach game/account/participant writes. Throws RoflParseError so
 * callers treat violations exactly like an unsupported replay (422 + cleanup,
 * nothing persisted).
 */
export function assertWithinIngestBudget(
  participants: ParsedParticipant[],
  limits: ReplayIngestLimits = REPLAY_INGEST_LIMITS,
): void {
  if (participants.length > limits.maxParticipants) {
    throw new RoflParseError(
      `Unsupported replay: ${participants.length} participants ` +
        `(supported maximum is ${limits.maxParticipants}).`,
    );
  }
  for (const participant of participants) {
    // `raw` is the parser's bounded allowlist subset; enforce the storage
    // budget on exactly what would be written to JSONB.
    if (
      new TextEncoder().encode(JSON.stringify(participant.raw)).length >
      limits.maxParticipantJsonBytes
    ) {
      throw new RoflParseError(
        "Unsupported replay: participant raw stats exceed the storage budget.",
      );
    }
  }
}
