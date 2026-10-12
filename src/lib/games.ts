import "server-only";

import { desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { gameParticipants, games, members, riotAccounts } from "@/db/schema";
import { isUuid } from "@/lib/validation";

export type GameVisibility = "active" | "excluded";

export type GameListItem = {
  id: string;
  playedAt: string;
  playedAtSource: string;
  durationMs: number | null;
  winningTeam: number | null;
  participantCount: number;
  comment: string | null;
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
  playedAt: string;
  playedAtSource: string;
  originalPlayedAt: string;
  originalPlayedAtSource: string;
  playedAtOverride: string | null;
  comment: string | null;
  excludedAt: Date | null;
  durationMs: number | null;
  gameVersion: string | null;
  winningTeam: number | null;
  originalFilename: string | null;
  participants: GameParticipantRow[];
};

const effectivePlayedAt =
  sql<string>`coalesce(${games.playedAtOverride}, ${games.playedAt})`.mapWith(
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
      comment: games.comment,
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
    comment: game.comment,
    excludedAt: game.excludedAt,
    durationMs: game.durationMs,
    gameVersion: game.gameVersion,
    winningTeam: game.winningTeam,
    originalFilename: game.originalFilename,
    participants,
  };
}
