import "server-only";

import { redirect } from "next/navigation";

import {
  countGames,
  getGameDetail,
  listGamesWithParticipants,
  type GameVisibility,
} from "@/lib/games";
import {
  getMemberAccounts,
  getMemberHistoryAggregates,
  getMemberHistoryPage,
  getMemberIdentity,
} from "@/lib/member-history";
import { projectMember } from "@/lib/member-privacy";
import { getMemberRelationshipHighlights } from "@/lib/member-relationships";
import { listMembersWithAccounts } from "@/lib/members";
import { getReadSession } from "@/lib/session";
import { parsePageNumber } from "@/lib/validation";
import { cachedQuery } from "@/lib/query-cache";
import { prepareCache, cacheDependencies } from "@/lib/cache-context";

/** Check live credentials before every role-specific cache read. */
async function readRole() {
  const session = await getReadSession();
  if (!session) redirect("/login");
  return session.role;
}

/** Only projected member information may reach a page or client component. */
export async function getMembersReadModel() {
  const role = await readRole();
  const context = await prepareCache(["members", "accounts"]);
  const projected = await cachedQuery(
    { query: "members", role, policy: "members" },
    async () => {
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
    },
    context,
  );
  return {
    role,
    members: projected,
  };
}

export async function getGameDetailReadModel(id: string) {
  const role = await readRole();
  const context = await prepareCache([`game:${id}`, "members", "accounts"]);
  const projected = await cachedQuery(
    { query: "game-detail-v2", role, args: [id], policy: "detail" },
    async () => {
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
              items: participant.items,
              gameName: participant.gameName,
              tagLine: participant.tagLine,
              memberId: participant.memberId,
              memberName: participant.memberName,
            })),
          }
        : null;
    },
    context,
  );
  return { role, game: projected };
}

export async function getMemberHistoryReadModel(
  id: string,
  limit = 25,
  offset = 0,
) {
  const role = await readRole();
  const current = await getMemberIdentity(id);
  if (!current) return { role, history: null };
  limit = Number.isSafeInteger(limit) && limit >= 0 ? Math.min(limit, 100) : 25;
  offset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  const context = await prepareCache(["members", "accounts", "history"]);
  const [accounts, aggregate, games, relationshipStats] = await Promise.all([
    cachedQuery(
      { query: "member-accounts-v3", role, args: [id], policy: "accounts" },
      () => getMemberAccounts(id),
      cacheDependencies(context, ["accounts"]),
    ),
    cachedQuery(
      { query: "member-aggregate-v3", role, args: [id], policy: "aggregate" },
      () => getMemberHistoryAggregates(id),
      cacheDependencies(context, ["history"]),
    ),
    cachedQuery(
      {
        query: "member-history-v4",
        role,
        args: [id, limit, offset],
        policy: "page",
        admit: limit > 0 && offset < limit * 20,
      },
      () => getMemberHistoryPage(id, limit, offset),
      context,
    ),
    cachedQuery(
      {
        query: "member-relationships-v1",
        role,
        args: [id],
        policy: "aggregate",
      },
      () => getMemberRelationshipHighlights(id),
      context,
    ),
  ]);
  return {
    role,
    history: {
      member: projectMember(
        { id: current.id, name: current.name, birthYear: current.birthYear },
        role,
      ),
      accounts,
      ...aggregate,
      games,
      relationshipStats,
    },
  };
}

export async function getGameListReadModel(
  pageSize: number,
  requestedPage: string | string[] | undefined,
  visibility: GameVisibility = "active",
) {
  const role = await readRole();
  pageSize =
    Number.isSafeInteger(pageSize) && pageSize > 0
      ? Math.min(pageSize, 100)
      : 10;
  const requested = parsePageNumber(requestedPage);
  const context = await prepareCache(["game-list", "members", "accounts"]);
  const total = await cachedQuery(
    { query: "game-count-v3", role, args: [visibility], policy: "list" },
    () => countGames(visibility),
    cacheDependencies(context, ["game-list"]),
  );
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requested, pageCount);
  const games = await cachedQuery(
    {
      query: "game-list-v3",
      role,
      args: [pageSize, page, visibility],
      policy: "list",
      admit: page <= 20,
    },
    () =>
      listGamesWithParticipants(pageSize, (page - 1) * pageSize, visibility),
    context,
  );
  return { role, total, page, pageCount, games };
}
