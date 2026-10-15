import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { gameParticipants, games, members, riotAccounts } from "@/db/schema";

export type MemberRelationshipKind =
  "allyWinRate" | "opponentWinRate" | "allyGames" | "opponentGames";

export type MemberRelationshipHighlight = {
  kind: MemberRelationshipKind;
  memberId: string;
  memberName: string;
  totalGames: number;
  wins: number;
  losses: number;
  undecided: number;
  winRate: number | null;
};

/** One indexed, full-history query; at most four projected member summaries. */
export async function getMemberRelationshipHighlights(
  memberId: string,
): Promise<MemberRelationshipHighlight[]> {
  const result = await db.execute<MemberRelationshipHighlight>(sql`
    with own_games as materialized (
      select g.id, max(p.team) as own_team, g.winning_team
      from ${riotAccounts} a
      join ${gameParticipants} p on p.riot_account_id = a.id
      join ${games} g on g.id = p.game_id
      where a.member_id = ${memberId}::uuid and g.excluded_at is null
      group by g.id
      having count(*) = 1 and max(p.team) in (100, 200)
    ), peer_games as (
      select o.id, o.own_team, o.winning_team, a.member_id,
        max(p.team) as peer_team
      from own_games o
      join ${gameParticipants} p on p.game_id = o.id
      join ${riotAccounts} a on a.id = p.riot_account_id
      where a.member_id is not null and a.member_id <> ${memberId}::uuid
      group by o.id, o.own_team, o.winning_team, a.member_id
      -- Count every linked participant before excluding unknown teams.
      having count(*) = 1 and max(p.team) in (100, 200)
    ), pairs as materialized (
      select member_id, peer_team = own_team as same_team,
        count(*)::int as total_games,
        (count(*) filter (where winning_team in (100, 200)))::int as decided,
        (count(*) filter (where winning_team = own_team))::int as wins,
        100.0 * count(*) filter (where winning_team = own_team)
          / nullif(count(*) filter (where winning_team in (100, 200)), 0)
          as win_rate
      from peer_games
      group by member_id, peer_team = own_team
      having count(*) >= 3
    )
    select chosen.kind, chosen.member_id as "memberId", m.name as "memberName",
      chosen.total_games as "totalGames", chosen.wins,
      chosen.decided - chosen.wins as losses,
      chosen.total_games - chosen.decided as undecided,
      chosen.win_rate::float8 as "winRate"
    from (
      (select 1 as sort_order, 'allyWinRate' as kind, * from pairs
        where same_team and decided > 0
        order by win_rate desc, decided desc, total_games desc, member_id limit 1)
      union all
      (select 2, 'opponentWinRate', * from pairs
        where not same_team and decided > 0
        order by win_rate desc, decided desc, total_games desc, member_id limit 1)
      union all
      (select 3, 'allyGames', * from pairs where same_team
        order by total_games desc, member_id limit 1)
      union all
      (select 4, 'opponentGames', * from pairs where not same_team
        order by total_games desc, member_id limit 1)
    ) chosen
    join ${members} m on m.id = chosen.member_id
    order by chosen.sort_order
  `);
  return result.rows;
}
