import Link from "next/link";
import { notFound } from "next/navigation";

import { resolveChampionNames } from "@/lib/champions";
import type { GameParticipantRow } from "@/lib/games";
import { getGameDetailReadModel } from "@/lib/read-model";
import { formatKoreaDateInput, playedAtSourceLabel } from "@/lib/game-date";
import { parsePageNumber } from "@/lib/validation";
import {
  formatDate,
  formatDuration,
  POSITION_ORDER,
  positionLabel,
  riotId,
  teamLabel,
} from "@/lib/format";

import {
  GameDateForm,
  GameFeedbackProvider,
  GameVisibilityForm,
} from "../forms";

export const dynamic = "force-dynamic";

function byPosition(a: GameParticipantRow, b: GameParticipantRow): number {
  const ai = a.position
    ? POSITION_ORDER.indexOf(a.position)
    : POSITION_ORDER.length;
  const bi = b.position
    ? POSITION_ORDER.indexOf(b.position)
    : POSITION_ORDER.length;
  return ai - bi;
}

export default async function GameDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string | string[]; view?: string | string[] }>;
}) {
  const [{ id }, { page, view }] = await Promise.all([params, searchParams]);
  const { game, role } = await getGameDetailReadModel(id);
  if (!game) notFound();
  const isAdmin = role !== "viewer";
  const returnToExcluded =
    view === "excluded" || (!view && Boolean(game.excludedAt));
  const backHref = `/games?${returnToExcluded ? "view=excluded&" : ""}page=${parsePageNumber(page)}`;

  const championNames = await resolveChampionNames(
    game.participants
      .map((p) => p.champion)
      .filter((c): c is string => Boolean(c)),
  );

  const teams = [100, 200].map((team) => ({
    team,
    result: gameResult(game.winningTeam, team),
    players: game.participants.filter((p) => p.team === team).sort(byPosition),
  }));
  const unassigned = game.participants.filter(
    (p) => p.team !== 100 && p.team !== 200,
  );

  return (
    <section className="stack">
      <div>
        <p className="muted">
          <Link href={backHref}>
            ← {returnToExcluded ? "제외된 경기 목록" : "게임 목록"}
          </Link>
        </p>
        <h1>게임 상세</h1>
        <p className="muted">
          {formatDate(game.playedAt)}
          {` (${playedAtSourceLabel(game.playedAtSource)})`} ·{" "}
          {formatDuration(game.durationMs)}
          {game.gameVersion ? ` · v${game.gameVersion}` : null}
        </p>
      </div>
      <GameFeedbackProvider>
        {game.excludedAt ? (
          <section className="card stack" aria-label="제외된 경기 안내">
            <h2>제외된 경기</h2>
            <p className="muted">
              이 경기는 기본 목록과 모임원 전적에 포함되지 않습니다. 원본
              리플레이와 참가자 기록은 보존되어 있습니다.
            </p>
            {isAdmin ? <GameVisibilityForm gameId={game.id} excluded /> : null}
          </section>
        ) : null}
        {teams.map(({ team, result, players }) =>
          players.length === 0 ? null : (
            <TeamBlock
              key={team}
              title={`${teamLabel(team)} 팀`}
              result={result}
              players={players}
              championNames={championNames}
            />
          ),
        )}

        {unassigned.length > 0 ? (
          <TeamBlock
            title="팀 미상"
            result="unknown"
            players={unassigned}
            championNames={championNames}
          />
        ) : null}
        {isAdmin ? (
          <section className="card stack">
            <h2>경기 날짜 수정</h2>
            <p className="muted">
              원본 날짜: {formatDate(game.originalPlayedAt)} (
              {playedAtSourceLabel(game.originalPlayedAtSource)})
            </p>
            <GameDateForm
              key={`${game.playedAt.toISOString()}:${Boolean(game.playedAtOverride)}`}
              gameId={game.id}
              currentValue={formatKoreaDateInput(game.playedAt)}
              originalValue={formatKoreaDateInput(game.originalPlayedAt)}
              hasOverride={Boolean(game.playedAtOverride)}
            />
          </section>
        ) : null}
        {isAdmin && !game.excludedAt ? (
          <section className="card stack">
            <h2>경기 제외</h2>
            <p className="muted">
              잘못 올린 경기나 테스트 경기를 목록과 모임원 전적에서 제외합니다.
              제외된 경기 목록에서 언제든 복구할 수 있습니다.
            </p>
            <GameVisibilityForm gameId={game.id} excluded={false} />
          </section>
        ) : null}
      </GameFeedbackProvider>
    </section>
  );
}

type TeamResult = "win" | "loss" | "unknown";

function gameResult(winningTeam: number | null, team: number): TeamResult {
  if (winningTeam == null) return "unknown";
  return winningTeam === team ? "win" : "loss";
}

const RESULT_BADGE: Record<TeamResult, { className: string; label: string }> = {
  win: { className: "badge badge-win", label: "승리" },
  loss: { className: "badge badge-loss", label: "패배" },
  unknown: { className: "badge badge-muted", label: "미정" },
};

function TeamBlock({
  title,
  result,
  players,
  championNames,
}: {
  title: string;
  result: TeamResult;
  players: GameParticipantRow[];
  championNames: Map<string, string>;
}) {
  const badge = RESULT_BADGE[result];
  return (
    <div className="team-block">
      <h3>
        {title} <span className={badge.className}>{badge.label}</span>
      </h3>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>포지션</th>
              <th>라이엇 아이디</th>
              <th>챔피언</th>
              <th>모임원</th>
              <th>K / D / A</th>
              <th>골드</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.position ? (
                    positionLabel(p.position)
                  ) : (
                    <span className="badge badge-muted">불명</span>
                  )}
                </td>
                <td>{riotId(p.gameName, p.tagLine)}</td>
                <td>
                  {p.champion
                    ? (championNames.get(p.champion) ?? p.champion)
                    : "-"}
                </td>
                <td>
                  {p.memberId && p.memberName ? (
                    <Link href={`/members/${p.memberId}`}>{p.memberName}</Link>
                  ) : (
                    <span className="muted">미연결</span>
                  )}
                </td>
                <td>
                  {p.kills ?? "-"} / {p.deaths ?? "-"} / {p.assists ?? "-"}
                </td>
                <td>
                  {p.goldEarned != null ? p.goldEarned.toLocaleString() : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
