import "server-only";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { gameParticipants, games, members, riotAccounts } from "@/db/schema";
import { isUuid } from "@/lib/validation";

export type MemberGameResult = "win" | "loss" | "unknown";

export type MemberHistoryGame = {
  id: string;
  playedAt: Date;
  playedAtSource: string;
  durationMs: number | null;
  champion: string | null;
  position: string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  result: MemberGameResult;
  ambiguous: boolean;
};

export type MemberHistoryStats = {
  totalGames: number;
  wins: number;
  losses: number;
  undecided: number;
  winRate: number | null;
  averageKills: number | null;
  averageDeaths: number | null;
  averageAssists: number | null;
};

export type MemberHistory = {
  member: { id: string; name: string; birthYear: number | null };
  accounts: { id: string; gameName: string; tagLine: string }[];
  stats: MemberHistoryStats;
  championStats: (MemberHistoryStats & { champion: string })[];
  games: MemberHistoryGame[];
};

/**
 * Current account links determine the member's entire history. Group in SQL
 * before pagination so multiple linked accounts in one game count only once;
 * ambiguous participation never invents a champion, outcome or K/D/A.
 */
export async function getMemberHistory(
  memberId: string,
  limit = 25,
  offset = 0,
): Promise<MemberHistory | null> {
  if (!isUuid(memberId)) return null;
  const [member] = await db
    .select({
      id: members.id,
      name: members.name,
      birthYear: members.birthYear,
    })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  if (!member) return null;

  const memberGames = db.$with("member_games").as(
    db
      .select({
        id: games.id,
        playedAt:
          sql<Date>`coalesce(${games.playedAtOverride}, ${games.playedAt})`
            .mapWith(games.playedAt)
            .as("effective_played_at"),
        playedAtSource: sql<string>`case
          when ${games.playedAtOverride} is not null then 'manual'
          else ${games.playedAtSource} end`.as("effective_played_at_source"),
        uploadedAt: games.uploadedAt,
        durationMs: games.durationMs,
        champion: sql<string | null>`case when count(*) = 1
          then max(${gameParticipants.champion}) else null end`.as("champion"),
        position: sql<string | null>`case when count(*) = 1
          then max(${gameParticipants.position}) else null end`.as("position"),
        kills: sql<number | null>`case when count(*) = 1
          then max(${gameParticipants.kills}) else null end`.as("kills"),
        deaths: sql<number | null>`case when count(*) = 1
          then max(${gameParticipants.deaths}) else null end`.as("deaths"),
        assists: sql<number | null>`case when count(*) = 1
          then max(${gameParticipants.assists}) else null end`.as("assists"),
        result: sql<MemberGameResult>`case
          when count(*) <> 1
            or ${games.winningTeam} is null
            or ${games.winningTeam} not in (100, 200)
            or max(${gameParticipants.team}) is null
            or max(${gameParticipants.team}) not in (100, 200) then 'unknown'
          when max(${gameParticipants.team}) = ${games.winningTeam} then 'win'
          else 'loss' end`.as("result"),
        ambiguous: sql<boolean>`count(*) > 1`.as("ambiguous"),
      })
      .from(games)
      .innerJoin(gameParticipants, eq(gameParticipants.gameId, games.id))
      .innerJoin(
        riotAccounts,
        eq(gameParticipants.riotAccountId, riotAccounts.id),
      )
      .where(and(eq(riotAccounts.memberId, memberId), isNull(games.excludedAt)))
      .groupBy(games.id),
  );

  const [accounts, [stats], history, championStats] = await Promise.all([
    db
      .select({
        id: riotAccounts.id,
        gameName: riotAccounts.gameName,
        tagLine: riotAccounts.tagLine,
      })
      .from(riotAccounts)
      .where(eq(riotAccounts.memberId, memberId))
      .orderBy(
        asc(riotAccounts.gameName),
        asc(riotAccounts.tagLine),
        asc(riotAccounts.id),
      ),
    db
      .with(memberGames)
      .select({
        totalGames: sql<number>`count(*)::int`,
        wins: sql<number>`(count(*) filter (where ${memberGames.result} = 'win'))::int`,
        losses: sql<number>`(count(*) filter (where ${memberGames.result} = 'loss'))::int`,
        undecided: sql<number>`(count(*) filter (where ${memberGames.result} = 'unknown'))::int`,
        winRate: sql<number | null>`(
          100.0 * count(*) filter (where ${memberGames.result} = 'win')
          / nullif(count(*) filter (where ${memberGames.result} in ('win', 'loss')), 0)
        )::float8`,
        // PostgreSQL avg ignores NULL independently for each counter, including
        // the NULLs deliberately produced for ambiguous participation above.
        averageKills: sql<number | null>`avg(${memberGames.kills})::float8`,
        averageDeaths: sql<number | null>`avg(${memberGames.deaths})::float8`,
        averageAssists: sql<number | null>`avg(${memberGames.assists})::float8`,
      })
      .from(memberGames),
    db
      .with(memberGames)
      .select({
        id: memberGames.id,
        playedAt: memberGames.playedAt,
        playedAtSource: memberGames.playedAtSource,
        durationMs: memberGames.durationMs,
        champion: memberGames.champion,
        position: memberGames.position,
        kills: memberGames.kills,
        deaths: memberGames.deaths,
        assists: memberGames.assists,
        result: memberGames.result,
        ambiguous: memberGames.ambiguous,
      })
      .from(memberGames)
      .orderBy(
        desc(memberGames.playedAt),
        desc(memberGames.uploadedAt),
        desc(memberGames.id),
      )
      .limit(
        Number.isSafeInteger(limit) && limit >= 0 ? Math.min(limit, 100) : 25,
      )
      .offset(Number.isSafeInteger(offset) && offset >= 0 ? offset : 0),
    db
      .with(memberGames)
      .select({
        champion: sql<string>`${memberGames.champion}`,
        totalGames: sql<number>`count(*)::int`,
        wins: sql<number>`(count(*) filter (where ${memberGames.result} = 'win'))::int`,
        losses: sql<number>`(count(*) filter (where ${memberGames.result} = 'loss'))::int`,
        undecided: sql<number>`(count(*) filter (where ${memberGames.result} = 'unknown'))::int`,
        winRate: sql<number | null>`(
          100.0 * count(*) filter (where ${memberGames.result} = 'win')
          / nullif(count(*) filter (where ${memberGames.result} in ('win', 'loss')), 0)
        )::float8`,
        averageKills: sql<number | null>`avg(${memberGames.kills})::float8`,
        averageDeaths: sql<number | null>`avg(${memberGames.deaths})::float8`,
        averageAssists: sql<number | null>`avg(${memberGames.assists})::float8`,
      })
      .from(memberGames)
      .where(sql`${memberGames.champion} is not null`)
      .groupBy(memberGames.champion)
      .orderBy(desc(sql`count(*)`), asc(memberGames.champion)),
  ]);

  return { member, accounts, stats, games: history, championStats };
}
