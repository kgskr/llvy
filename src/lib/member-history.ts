import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { gameParticipants, games, members, riotAccounts } from "@/db/schema";
import { isUuid } from "@/lib/validation";
import { readParticipantLoadout } from "@/lib/participant-loadout";

export type MemberGameResult = "win" | "loss" | "unknown";

export type MemberHistoryParticipant = {
  id: string;
  team: number | null;
  position: string | null;
  champion: string | null;
  gameName: string;
  tagLine: string;
  memberId: string | null;
  memberName: string | null;
  isMember: boolean;
};

export type MemberHistoryGame = {
  id: string;
  playedAt: string;
  playedAtSource: string;
  durationMs: number | null;
  champion: string | null;
  position: string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  result: MemberGameResult;
  ambiguous: boolean;
  gameVersion: string | null;
  level: number | null;
  items: (number | null)[];
  participants: MemberHistoryParticipant[];
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
  championStats: (MemberHistoryStats & {
    champion: string;
    position: string | null;
  })[];
  positionStats: {
    position: string | null;
    totalGames: number;
    winRate: number | null;
  }[];
  games: MemberHistoryGame[];
};

/** Fresh identity lookup for navigation, independent of cached game statistics. */
export async function getMemberIdentity(memberId: string) {
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
  return member ?? null;
}

/** Current account links determine history, grouped before pagination. */
function memberGamesQuery(memberId: string) {
  return db.$with("member_games").as(
    db
      .select({
        id: games.id,
        playedAt:
          sql<string>`coalesce(${games.playedAtOverride}, ${games.playedAt})`
            .mapWith(games.playedAt)
            .as("effective_played_at"),
        playedAtSource: sql<string>`case
          when ${games.playedAtOverride} is not null then 'manual'
          else ${games.playedAtSource} end`.as("effective_played_at_source"),
        uploadedAt: games.uploadedAt,
        durationMs: games.durationMs,
        gameVersion: games.gameVersion,
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
}
export async function getMemberAccounts(memberId: string) {
  return db
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
    );
}
export async function getMemberHistoryAggregates(memberId: string) {
  const memberGames = memberGamesQuery(memberId);
  const [[stats], championStats, positionStats] = await Promise.all([
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
        champion: sql<string>`${memberGames.champion}`,
        position: memberGames.position,
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
      .groupBy(memberGames.champion, memberGames.position)
      .orderBy(
        desc(sql`count(*)`),
        asc(memberGames.champion),
        asc(memberGames.position),
      ),
    db
      .with(memberGames)
      .select({
        position: memberGames.position,
        totalGames: sql<number>`count(*)::int`,
        winRate: sql<number | null>`(
          100.0 * count(*) filter (where ${memberGames.result} = 'win')
          / nullif(count(*) filter (where ${memberGames.result} in ('win', 'loss')), 0)
        )::float8`,
      })
      .from(memberGames)
      .where(sql`not ${memberGames.ambiguous}`)
      .groupBy(memberGames.position)
      .orderBy(desc(sql`count(*)`), asc(memberGames.position)),
  ]);
  return { stats, championStats, positionStats };
}
export async function getMemberHistoryPage(
  memberId: string,
  limit = 25,
  offset = 0,
): Promise<MemberHistoryGame[]> {
  const memberGames = memberGamesQuery(memberId);
  const history = await db
    .with(memberGames)
    .select({
      id: memberGames.id,
      playedAt: memberGames.playedAt,
      playedAtSource: memberGames.playedAtSource,
      durationMs: memberGames.durationMs,
      gameVersion: memberGames.gameVersion,
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
    .offset(Number.isSafeInteger(offset) && offset >= 0 ? offset : 0);
  // Enrich only the paginated games, once. Never load whole raw_stats objects
  // or call getGameDetail for each row; even other players' loadouts stay in DB.
  const pageParticipants =
    history.length === 0
      ? []
      : await db
          .select({
            id: gameParticipants.id,
            gameId: gameParticipants.gameId,
            team: gameParticipants.team,
            position: gameParticipants.position,
            champion: gameParticipants.champion,
            gameName: riotAccounts.gameName,
            tagLine: riotAccounts.tagLine,
            memberId: members.id,
            memberName: members.name,
            isMember: sql<boolean>`coalesce(${riotAccounts.memberId} = ${memberId}, false)`,
            loadout: sql<unknown>`case when ${riotAccounts.memberId} = ${memberId}
        then jsonb_build_object(
          'LEVEL', ${gameParticipants.rawStats}->'LEVEL',
          'ITEM0', ${gameParticipants.rawStats}->'ITEM0',
          'ITEM1', ${gameParticipants.rawStats}->'ITEM1',
          'ITEM2', ${gameParticipants.rawStats}->'ITEM2',
          'ITEM3', ${gameParticipants.rawStats}->'ITEM3',
          'ITEM4', ${gameParticipants.rawStats}->'ITEM4',
          'ITEM5', ${gameParticipants.rawStats}->'ITEM5',
          'ITEM6', ${gameParticipants.rawStats}->'ITEM6'
        ) else null end`,
          })
          .from(gameParticipants)
          .innerJoin(
            riotAccounts,
            eq(gameParticipants.riotAccountId, riotAccounts.id),
          )
          .leftJoin(members, eq(riotAccounts.memberId, members.id))
          .where(
            inArray(
              gameParticipants.gameId,
              history.map((game) => game.id),
            ),
          )
          .orderBy(asc(gameParticipants.id));
  const byGame = new Map<string, typeof pageParticipants>();
  for (const participant of pageParticipants) {
    const group = byGame.get(participant.gameId) ?? [];
    group.push(participant);
    byGame.set(participant.gameId, group);
  }

  return history.map((game) => {
    const participants = byGame.get(game.id) ?? [];
    const own = participants.filter((participant) => participant.isMember);
    const loadout = !game.ambiguous && own.length === 1 ? own[0].loadout : null;
    return {
      ...game,
      ...readParticipantLoadout(loadout),
      participants: participants.map((participant) => ({
        id: participant.id,
        team: participant.team,
        position: participant.position,
        champion: participant.champion,
        gameName: participant.gameName,
        tagLine: participant.tagLine,
        memberId: participant.memberId,
        memberName: participant.memberName,
        isMember: participant.isMember,
      })),
    };
  });
}

/** Compatibility facade; the read model caches the independent pieces. */
export async function getMemberHistory(
  memberId: string,
  limit = 25,
  offset = 0,
): Promise<MemberHistory | null> {
  const member = await getMemberIdentity(memberId);
  if (!member) return null;
  const [accounts, aggregates, games] = await Promise.all([
    getMemberAccounts(memberId),
    getMemberHistoryAggregates(memberId),
    getMemberHistoryPage(memberId, limit, offset),
  ]);
  return { member, accounts, ...aggregates, games };
}
