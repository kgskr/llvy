import "server-only";

import { redirect } from "next/navigation";

import {
  countGames,
  getGameDetail,
  listGames,
  type GameVisibility,
} from "@/lib/games";
import { getMemberHistory } from "@/lib/member-history";
import { memberDisplayName, projectMember } from "@/lib/member-privacy";
import { listMembersWithAccounts } from "@/lib/members";
import { getSession } from "@/lib/session";
import { parsePageNumber } from "@/lib/validation";

/** Check live credentials before every role-specific cache read. */
async function readRole() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.role;
}

/** Only projected member information may reach a page or client component. */
export async function getMembersReadModel() {
  const role = await readRole();
  const projected = await (async () => {
    const members = await listMembersWithAccounts();
    return members.map((member) =>
      projectMember(
        {
          id: member.id,
          name: member.name,
          birthYear: member.birthYear,
          accounts: member.accounts,
        },
        role,
      ),
    );
  })();
  return {
    role,
    members: projected,
  };
}

export async function getGameDetailReadModel(id: string) {
  const role = await readRole();
  const projected = await (async () => {
    const game = await getGameDetail(id);
    return game
      ? {
          id: game.id,
          playedAt: game.playedAt,
          playedAtSource: game.playedAtSource,
          originalPlayedAt: game.originalPlayedAt,
          originalPlayedAtSource: game.originalPlayedAtSource,
          playedAtOverride: game.playedAtOverride,
          comment: game.comment,
          excludedAt: game.excludedAt?.toISOString() ?? null,
          durationMs: game.durationMs,
          gameVersion: game.gameVersion,
          winningTeam: game.winningTeam,
          participants: game.participants.map((participant) => ({
            id: participant.id,
            team: participant.team,
            position: participant.position,
            champion: participant.champion,
            win: participant.win,
            kills: participant.kills,
            deaths: participant.deaths,
            assists: participant.assists,
            goldEarned: participant.goldEarned,
            gameName: participant.gameName,
            tagLine: participant.tagLine,
            memberId: participant.memberId,
            memberName:
              participant.memberName === null
                ? null
                : memberDisplayName(participant.memberName, role),
          })),
        }
      : null;
  })();
  return { role, game: projected };
}

export async function getMemberHistoryReadModel(
  id: string,
  limit = 25,
  offset = 0,
) {
  const role = await readRole();
  const projected = await (async () => {
    const history = await getMemberHistory(id, limit, offset);
    return history
      ? {
          member: projectMember(
            {
              id: history.member.id,
              name: history.member.name,
              birthYear: history.member.birthYear,
            },
            role,
          ),
          accounts: history.accounts,
          stats: history.stats,
          championStats: history.championStats,
          positionStats: history.positionStats,
          games: history.games,
        }
      : null;
  })();
  return { role, history: projected };
}

export async function getGameListReadModel(
  pageSize: number,
  requestedPage: string | string[] | undefined,
  visibility: GameVisibility = "active",
) {
  const role = await readRole();
  const requested = parsePageNumber(requestedPage);
  const listing = await (async () => {
    const total = await countGames(visibility);
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requested, pageCount);
    const games = await listGames(pageSize, (page - 1) * pageSize, visibility);
    return { total, page, pageCount, games };
  })();
  return { role, ...listing };
}
