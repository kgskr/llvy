import "server-only";

import { desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { gameParticipants, games, members, riotAccounts } from "@/db/schema";
import { isUuid } from "@/lib/validation";

export type GameVisibility = "active" | "excluded";

export type GameListItem = {
  id: string;
  playedAt: Date;
  playedAtSource: string;
  durationMs: number | null;
  winningTeam: number | null;
  participantCount: number;
};

export type GameParticipantRow = {
  id: string;
  team: number | null;
  position: string | null;
  champion: string | null;
  win: boolean | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  goldEarned: number | null;
  gameName: string;
  tagLine: string;
  memberId: string | null;
  memberName: string | null;
};

export type GameDetail = {
  id: string;
  playedAt: Date;
  playedAtSource: string;
  originalPlayedAt: Date;
  originalPlayedAtSource: string;
  playedAtOverride: Date | null;
  excludedAt: Date | null;
  durationMs: number | null;
  gameVersion: string | null;
  winningTeam: number | null;
  originalFilename: string | null;
  participants: GameParticipantRow[];
};

const effectivePlayedAt =
  sql<Date>`coalesce(${games.playedAtOverride}, ${games.playedAt})`.mapWith(
    games.playedAt,
  );
const effectivePlayedAtSource = sql<string>`case
  when ${games.playedAtOverride} is not null then 'manual'
  else ${games.playedAtSource} end`;

function visibilityFilter(visibility: GameVisibility) {
  return visibility === "excluded"
    ? isNotNull(games.excludedAt)
    : isNull(games.excludedAt);
}

/** Stored games, most recent first by corrected date when one is present. */
export async function listGames(
  limit = 100,
  offset = 0,
  visibility: GameVisibility = "active",
): Promise<GameListItem[]> {
  return db
    .select({
      id: games.id,
      playedAt: effectivePlayedAt,
      playedAtSource: effectivePlayedAtSource,
      durationMs: games.durationMs,
      winningTeam: games.winningTeam,
      participantCount: sql<number>`count(${gameParticipants.id})::int`,
    })
    .from(games)
    .leftJoin(gameParticipants, eq(gameParticipants.gameId, games.id))
    .where(visibilityFilter(visibility))
    .groupBy(games.id)
    .orderBy(desc(effectivePlayedAt), desc(games.uploadedAt), desc(games.id))
    .limit(
      Number.isSafeInteger(limit) && limit >= 0 ? Math.min(limit, 100) : 100,
    )
    .offset(Number.isSafeInteger(offset) && offset >= 0 ? offset : 0);
}

export async function countGames(
  visibility: GameVisibility = "active",
): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(games)
    .where(visibilityFilter(visibility));
  return rows[0].total;
}

/** A single game with its participants, each resolved to a member if linked. */
export async function getGameDetail(id: string): Promise<GameDetail | null> {
  if (!isUuid(id)) return null;
  const gameRows = await db
    .select()
    .from(games)
    .where(eq(games.id, id))
    .limit(1);
  if (gameRows.length === 0) return null;
  const game = gameRows[0];

  const participants = await db
    .select({
      id: gameParticipants.id,
      team: gameParticipants.team,
      position: gameParticipants.position,
      champion: gameParticipants.champion,
      win: gameParticipants.win,
      kills: gameParticipants.kills,
      deaths: gameParticipants.deaths,
      assists: gameParticipants.assists,
      goldEarned: gameParticipants.goldEarned,
      gameName: riotAccounts.gameName,
      tagLine: riotAccounts.tagLine,
      memberId: members.id,
      memberName: members.name,
    })
    .from(gameParticipants)
    .innerJoin(
      riotAccounts,
      eq(gameParticipants.riotAccountId, riotAccounts.id),
    )
    .leftJoin(members, eq(riotAccounts.memberId, members.id))
    .where(eq(gameParticipants.gameId, id));

  return {
    id: game.id,
    playedAt: game.playedAtOverride ?? game.playedAt,
    playedAtSource: game.playedAtOverride ? "manual" : game.playedAtSource,
    originalPlayedAt: game.playedAt,
    originalPlayedAtSource: game.playedAtSource,
    playedAtOverride: game.playedAtOverride,
    excludedAt: game.excludedAt,
    durationMs: game.durationMs,
    gameVersion: game.gameVersion,
    winningTeam: game.winningTeam,
    originalFilename: game.originalFilename,
    participants,
  };
}

/** Reversible exclusion preserves the replay, its content hash and participants. */
export async function setGameExcluded(
  id: string,
  excluded: boolean,
): Promise<boolean> {
  if (!isUuid(id) || typeof excluded !== "boolean") return false;
  const rows = await db
    .update(games)
    .set({
      excludedAt: excluded ? sql`coalesce(${games.excludedAt}, now())` : null,
    })
    .where(eq(games.id, id))
    .returning({ id: games.id });
  return rows.length > 0;
}

/** Correct only the override; null restores the preserved source timestamp. */
export async function setGamePlayedAt(
  id: string,
  playedAt: Date | null,
): Promise<boolean> {
  if (!isUuid(id)) return false;
  if (
    playedAt !== null &&
    (!(playedAt instanceof Date) || !Number.isFinite(playedAt.getTime()))
  ) {
    return false;
  }
  const rows = await db
    .update(games)
    .set({ playedAtOverride: playedAt })
    .where(eq(games.id, id))
    .returning({ id: games.id });
  return rows.length > 0;
}
