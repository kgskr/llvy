import "server-only";

import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { gameParticipants, games, riotAccounts } from "@/db/schema";
import { assertWithinIngestBudget } from "@/lib/ingest-budget";
import {
  parseRofl,
  RoflParseError,
  type ParsedParticipant,
} from "@/lib/rofl/parser";

export type IngestResult = {
  gameId: string;
  duplicate: boolean;
};

// Earliest plausible play date (League of Legends launched in 2009).
const MIN_PLAYED_AT = Date.UTC(2009, 0, 1);
const MAX_TRANSACTION_ATTEMPTS = 3;

function resolvePlayedAt(lastModified: number | null | undefined): {
  playedAt: Date;
  playedAtSource: "file_mtime" | "upload";
} {
  if (
    typeof lastModified === "number" &&
    Number.isFinite(lastModified) &&
    lastModified > MIN_PLAYED_AT &&
    lastModified <= Date.now() + 24 * 60 * 60 * 1000
  ) {
    return { playedAt: new Date(lastModified), playedAtSource: "file_mtime" };
  }
  return { playedAt: new Date(), playedAtSource: "upload" };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Parse a .rofl and persist it as one game plus its participants. Idempotent on
 * the file content hash: a replay already stored returns the existing game with
 * `duplicate: true` and writes nothing new.
 */
export async function ingestReplay(input: {
  bytes: Uint8Array;
  blobUrl: string;
  originalFilename: string | null;
  lastModified: number | null;
}): Promise<IngestResult> {
  const fileHash = sha256Hex(input.bytes);

  const existing = await db
    .select({ id: games.id })
    .from(games)
    .where(eq(games.fileHash, fileHash))
    .limit(1);
  if (existing.length > 0) {
    return { gameId: existing[0].id, duplicate: true };
  }

  // Throws RoflParseError for unsupported/corrupt files (caught by the caller).
  const parsed = parseRofl(input.bytes);
  // Budgets are enforced by the parser; re-validate the DB work they imply
  // (participant rows, account upserts, JSONB size) BEFORE opening the
  // transaction so an over-budget replay performs no writes at all.
  assertWithinIngestBudget(parsed.participants);
  const { playedAt, playedAtSource } = resolvePlayedAt(input.lastModified);
  // Upserts hold account row locks until commit. Use the same identity order
  // across replays even when teams, positions, or display names have changed.
  const participants = [...parsed.participants].sort((a, b) => {
    const left = participantIdentityKey(a);
    const right = participantIdentityKey(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });

  return retryRolledBackTransaction(() =>
    db.transaction(async (tx) => {
      const inserted = await tx
        .insert(games)
        .values({
          fileHash,
          blobUrl: input.blobUrl,
          originalFilename: input.originalFilename,
          playedAt,
          playedAtSource,
          durationMs: parsed.durationMs,
          gameVersion: parsed.gameVersion,
          winningTeam: parsed.winningTeam,
          // Already reduced to a bounded scalar allowlist by the parser (the
          // per-player stats are stored normalized in game_participants).
          rawMetadata: parsed.rawMetadata,
        })
        .onConflictDoNothing({ target: games.fileHash })
        .returning({ id: games.id });

      // Lost a race with a concurrent upload of the same replay: nothing else has
      // been written, so just return the winner's game id.
      if (inserted.length === 0) {
        const row = await tx
          .select({ id: games.id })
          .from(games)
          .where(eq(games.fileHash, fileHash))
          .limit(1);
        return { gameId: row[0].id, duplicate: true };
      }

      const gameId = inserted[0].id;

      // Resolve accounts sequentially on the transaction connection. Repeated
      // identities indicate a corrupt replay; never silently drop participants.
      const seen = new Set<string>();
      const participantRows: (typeof gameParticipants.$inferInsert)[] = [];
      for (const p of participants) {
        const accountId = await findOrCreateAccount(tx, p);
        if (seen.has(accountId)) {
          throw new RoflParseError(
            "Unsupported replay: multiple participants resolve to the same Riot account.",
          );
        }
        seen.add(accountId);
        participantRows.push({
          gameId,
          riotAccountId: accountId,
          team: p.team,
          position: p.position,
          champion: p.champion,
          win: p.win,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          goldEarned: p.goldEarned,
          rawStats: p.raw,
        });
      }

      await tx.insert(gameParticipants).values(participantRows);

      return { gameId, duplicate: false };
    }),
  );
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function participantIdentityKey(participant: ParsedParticipant): string {
  return JSON.stringify(
    participant.puuid
      ? ["puuid", participant.puuid]
      : ["riot-id", participant.riotGameName, participant.riotTagLine],
  );
}

/** Drizzle wraps driver errors in `cause`; an outer transport error takes
 * precedence because it may mean the transaction outcome is unknown. */
function postgresErrorCode(error: unknown): string | null {
  const seen = new Set<object>();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    if ("code" in error && typeof error.code === "string") return error.code;
    error = "cause" in error ? error.cause : null;
  }
  return null;
}

/** Mixed legacy/PUUID identities can still acquire conflicting locks. Retry
 * only PostgreSQL errors that guarantee rollback, never a lost COMMIT reply. */
async function retryRolledBackTransaction<T>(
  work: () => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      const code = postgresErrorCode(error);
      if (
        attempt >= MAX_TRANSACTION_ATTEMPTS ||
        (code !== "40P01" && code !== "40001")
      ) {
        throw error;
      }
      await delay(25 * attempt + Math.floor(Math.random() * 25));
    }
  }
}

function isUniqueConflict(error: unknown): boolean {
  return postgresErrorCode(error) === "23505";
}

/**
 * Resolve a participant's Riot account, creating an unlinked (member_id = NULL)
 * one on first sighting. Identity is the stable `puuid` when present, so a
 * renamed player keeps one account (and its member link); pre-Riot-ID replays
 * without a puuid fall back to (game_name, tag_line).
 */
async function findOrCreateAccount(
  tx: Tx,
  p: ParsedParticipant,
): Promise<string> {
  const sameName = and(
    eq(riotAccounts.gameName, p.riotGameName),
    eq(riotAccounts.tagLine, p.riotTagLine),
  );

  if (p.puuid) {
    const known = await tx
      .select({ id: riotAccounts.id })
      .from(riotAccounts)
      .where(eq(riotAccounts.puuid, p.puuid))
      .limit(1);
    if (known.length === 0) {
      const namesakes = await tx
        .select({ puuid: riotAccounts.puuid })
        .from(riotAccounts)
        .where(sameName)
        .limit(2);
      // An older replay may already have established this Riot ID and its
      // member link without a PUUID. Upgrade that row instead of splitting the
      // member's history across two accounts. A savepoint isolates a concurrent
      // PUUID insertion; the ordinary upsert below then resolves the winner.
      try {
        // A reused Riot ID with multiple known identities is ambiguous. Only
        // promote a lone legacy account, never merge those histories by name.
        if (namesakes.length === 1 && namesakes[0].puuid === null) {
          const promoted = await tx.transaction(async (savepoint) =>
            savepoint
              .update(riotAccounts)
              .set({ puuid: p.puuid })
              .where(and(sameName, isNull(riotAccounts.puuid)))
              .returning({ id: riotAccounts.id }),
          );
          if (promoted.length > 0) return promoted[0].id;
        }
      } catch (error) {
        if (!isUniqueConflict(error)) throw error;
      }
    }
    const rows = await tx
      .insert(riotAccounts)
      .values({
        gameName: p.riotGameName,
        tagLine: p.riotTagLine,
        puuid: p.puuid,
      })
      .onConflictDoUpdate({
        target: riotAccounts.puuid,
        targetWhere: sql`${riotAccounts.puuid} is not null`,
        // Refresh the display Riot ID in case the player renamed.
        set: {
          gameName: sql`excluded.game_name`,
          tagLine: sql`excluded.tag_line`,
        },
      })
      .returning({ id: riotAccounts.id });
    return rows[0].id;
  }

  // PUUID-less replays can still resolve an unambiguous existing account.
  // Multiple stable identities can reuse a display name; do not guess then.
  const candidates = await tx
    .select({ id: riotAccounts.id })
    .from(riotAccounts)
    .where(sameName)
    .limit(2);
  if (candidates.length === 1) return candidates[0].id;

  const rows = await tx
    .insert(riotAccounts)
    .values({
      gameName: p.riotGameName,
      tagLine: p.riotTagLine,
      puuid: null,
    })
    .onConflictDoUpdate({
      target: [riotAccounts.gameName, riotAccounts.tagLine],
      targetWhere: sql`${riotAccounts.puuid} is null`,
      // No-op update so RETURNING yields the existing row's id.
      set: { gameName: sql`excluded.game_name` },
    })
    .returning({ id: riotAccounts.id });
  return rows[0].id;
}
