import Link from "next/link";

import { AssetIcon } from "@/app/(app)/asset-icon";
import {
  formatDuration,
  formatGameDate,
  POSITION_ORDER,
  riotId,
} from "@/lib/format";
import { playedAtSourceLabel } from "@/lib/game-date";
import type {
  GameListParticipant,
  GameListWithParticipants,
  GameVisibility,
} from "@/lib/games";

import { GameVisibilityForm } from "./forms";

const POSITION_CODES: Record<string, string> = {
  TOP: "TOP",
  JUNGLE: "JUG",
  MIDDLE: "MID",
  BOTTOM: "BOT",
  UTILITY: "SUP",
};

function displayName(player: GameListParticipant) {
  return player.memberName ?? riotId(player.gameName, player.tagLine);
}

function orderPlayers(a: GameListParticipant, b: GameListParticipant) {
  const rank = (position: string | null) => {
    const index = POSITION_ORDER.indexOf(position ?? "");
    return index < 0 ? POSITION_ORDER.length : index;
  };
  return (
    rank(a.position) - rank(b.position) ||
    displayName(a).localeCompare(displayName(b), "ko") ||
    a.id.localeCompare(b.id)
  );
}

export function GameList({
  games,
  championNames,
  championPortraits,
  visibility,
  page,
  canRestore,
}: {
  games: GameListWithParticipants[];
  championNames: Map<string, string>;
  championPortraits: Map<string, string>;
  visibility: GameVisibility;
  page: number;
  canRestore: boolean;
}) {
  return (
    <ol className="game-list" aria-label="게임 목록">
      {games.map((game) => {
        const winner =
          game.winningTeam === 100
            ? "blue"
            : game.winningTeam === 200
              ? "red"
              : "unknown";
        const result =
          winner === "blue"
            ? "블루 팀 승리"
            : winner === "red"
              ? "레드 팀 승리"
              : "승리 팀 미확인";
        const teams = [
          {
            key: "blue",
            label: "블루 팀",
            players: game.participants.filter((p) => p.team === 100),
          },
          {
            key: "red",
            label: "레드 팀",
            players: game.participants.filter((p) => p.team === 200),
          },
          {
            key: "unknown",
            label: "팀 미확인",
            players: game.participants.filter(
              (p) => p.team !== 100 && p.team !== 200,
            ),
          },
        ];
        return (
          <li key={game.id}>
            <article
              className={`game-list-row game-list-${winner}`}
              aria-label={`${formatGameDate(game.playedAt)} ${result}`}
            >
              <div className="game-list-overview">
                <time dateTime={game.playedAt}>
                  {formatGameDate(game.playedAt)}
                </time>
                <span className="game-list-date-source">
                  {playedAtSourceLabel(game.playedAtSource)}
                </span>
                <span className="game-list-duration">
                  {formatDuration(game.durationMs)}
                </span>
                <strong className="game-list-result">{result}</strong>
              </div>
              <div className="game-list-teams" aria-label="참여자">
                {teams
                  .filter((team, index) => index < 2 || team.players.length > 0)
                  .map((team) => (
                    <section
                      className={`game-list-team game-list-team-${team.key}`}
                      aria-label={team.label}
                      key={team.key}
                    >
                      <h2>{team.label}</h2>
                      <ul>
                        {team.players.sort(orderPlayers).map((player) => {
                          const name = displayName(player);
                          const champion =
                            (player.champion &&
                              championNames.get(player.champion)) ||
                            player.champion ||
                            "챔피언 정보 없음";
                          return (
                            <li className="game-list-player" key={player.id}>
                              <span className="game-list-position">
                                {POSITION_CODES[player.position ?? ""] ??
                                  "불명"}
                              </span>
                              <div className="game-list-identity">
                                <AssetIcon
                                  src={
                                    player.champion
                                      ? championPortraits.get(player.champion)
                                      : undefined
                                  }
                                  label={champion}
                                  size={24}
                                />
                                {player.memberId &&
                                player.memberName !== null ? (
                                  <Link
                                    className="game-list-name"
                                    href={`/members/${player.memberId}`}
                                    prefetch={false}
                                    title={name}
                                  >
                                    {name}
                                  </Link>
                                ) : (
                                  <span className="game-list-name" title={name}>
                                    {name}
                                  </span>
                                )}
                              </div>
                            </li>
                          );
                        })}
                        {team.players.length === 0 ? (
                          <li className="game-list-no-players">
                            참가자 정보 없음
                          </li>
                        ) : null}
                      </ul>
                    </section>
                  ))}
              </div>
              <div className="game-list-actions">
                <Link
                  href={`/games/${game.id}?view=${visibility}&page=${page}`}
                  prefetch={false}
                >
                  상세 →
                </Link>
                {canRestore ? (
                  <GameVisibilityForm gameId={game.id} excluded />
                ) : null}
              </div>
              <p className="game-list-comment">
                <span>코멘트</span>
                <span>{game.comment ?? "—"}</span>
              </p>
            </article>
          </li>
        );
      })}
    </ol>
  );
}
