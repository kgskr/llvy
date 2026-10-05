import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { resolveChampionNames } from "@/lib/champions";
import {
  formatDate,
  formatDuration,
  positionLabel,
  riotId,
} from "@/lib/format";
import { playedAtSourceLabel } from "@/lib/game-date";
import { getMemberHistory } from "@/lib/member-history";
import { parsePageNumber } from "@/lib/validation";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const RESULTS = {
  win: { label: "승리", className: "badge badge-win" },
  loss: { label: "패배", className: "badge badge-loss" },
  unknown: { label: "미정", className: "badge badge-muted" },
};

function average(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

export default async function MemberHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const [{ id }, { page: requestedPage }] = await Promise.all([
    params,
    searchParams,
  ]);
  // Keep offset arithmetic exact even for deliberately huge query parameters.
  const page = Math.min(
    parsePageNumber(requestedPage),
    Math.floor(Number.MAX_SAFE_INTEGER / PAGE_SIZE),
  );
  const history = await getMemberHistory(id, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  if (!history) notFound();
  const pageCount = Math.max(
    1,
    Math.ceil(history.stats.totalGames / PAGE_SIZE),
  );
  if (page > pageCount) redirect(`/members/${id}?page=${pageCount}`);

  const { member, accounts, stats, games, championStats } = history;
  const champions = [
    ...championStats.map((summary) => summary.champion),
    ...games.flatMap((game) => (game.champion ? [game.champion] : [])),
  ];
  const championNames =
    champions.length > 0
      ? await resolveChampionNames(champions)
      : new Map<string, string>();

  return (
    <section className="stack">
      <div>
        <p className="muted">
          <Link href="/members">← 모임원 목록</Link>
        </p>
        <h1>{member.name}의 전적</h1>
        <p className="muted">
          연결된 계정 {accounts.length}개 · 제외된 경기는 집계하지 않습니다.
        </p>
      </div>

      <dl className="stats-grid">
        <div className="card">
          <dt>전체 경기</dt>
          <dd>{stats.totalGames.toLocaleString()}경기</dd>
        </div>
        <div className="card">
          <dt>승 / 패 / 미정</dt>
          <dd>
            {stats.wins} / {stats.losses} / {stats.undecided}
          </dd>
        </div>
        <div className="card">
          <dt>승률</dt>
          <dd>
            {stats.winRate === null ? "—" : `${stats.winRate.toFixed(1)}%`}
          </dd>
        </div>
        <div className="card">
          <dt>평균 K / D / A</dt>
          <dd>
            {average(stats.averageKills)} / {average(stats.averageDeaths)} /{" "}
            {average(stats.averageAssists)}
          </dd>
        </div>
      </dl>
      <p className="form-note">
        승률은 승패가 결정된 경기 기준입니다. 평균은 값이 있는 경기만 계산하며,
        한 경기에 여러 계정이 연결된 경우 승패·평균 집계에서 제외합니다.
      </p>

      <section className="card stack">
        <h2>플레이한 챔피언</h2>
        {championStats.length === 0 ? (
          <p className="muted">집계할 챔피언 전적이 없습니다.</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">챔피언</th>
                  <th scope="col">경기 수</th>
                  <th scope="col">승 / 패 / 미정</th>
                  <th scope="col">승률</th>
                  <th scope="col">평균 K / D / A</th>
                </tr>
              </thead>
              <tbody>
                {championStats.map((summary) => (
                  <tr key={summary.champion}>
                    <th scope="row">
                      {championNames.get(summary.champion) ?? summary.champion}
                    </th>
                    <td>{summary.totalGames.toLocaleString()}경기</td>
                    <td>
                      {summary.wins} / {summary.losses} / {summary.undecided}
                    </td>
                    <td>
                      {summary.winRate === null
                        ? "—"
                        : `${summary.winRate.toFixed(1)}%`}
                    </td>
                    <td>
                      {average(summary.averageKills)} /{" "}
                      {average(summary.averageDeaths)} /{" "}
                      {average(summary.averageAssists)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="form-note">
          연결된 모든 계정의 전체 전적을 챔피언별로 집계합니다. 챔피언을 확인할
          수 없는 경기와 계정 중복 연결 경기는 제외합니다.
        </p>
      </section>

      <section className="card stack">
        <h2>연결된 라이엇 계정</h2>
        {accounts.length > 0 ? (
          <ul className="account-list">
            {accounts.map((account) => (
              <li key={account.id}>
                {riotId(account.gameName, account.tagLine)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            계정을 연결하면 이미 저장된 경기의 전적도 표시됩니다.
          </p>
        )}
        <Link href="/admin">계정 연결 관리 →</Link>
      </section>

      <section className="stack">
        <h2>최근 경기</h2>
        {games.length === 0 ? (
          <p className="empty-state">
            집계할 경기가 없습니다.{" "}
            <Link href="/upload">리플레이 업로드 →</Link>
          </p>
        ) : (
          <>
            <p className="muted">
              {page} / {pageCount}페이지 · 날짜는 한국 시간 기준
            </p>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>경기 날짜</th>
                    <th>결과</th>
                    <th>챔피언 / 포지션</th>
                    <th>K / D / A</th>
                    <th>길이</th>
                    <th>
                      <span className="sr-only">상세 보기</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {games.map((game) => (
                    <tr key={game.id}>
                      <td>
                        {formatDate(game.playedAt)}
                        <small className="table-note">
                          {playedAtSourceLabel(game.playedAtSource)}
                        </small>
                      </td>
                      <td>
                        <span className={RESULTS[game.result].className}>
                          {RESULTS[game.result].label}
                        </span>
                      </td>
                      <td>
                        {game.ambiguous ? (
                          <Link href="/admin">계정 중복 연결 확인</Link>
                        ) : (
                          <>
                            {game.champion
                              ? (championNames.get(game.champion) ??
                                game.champion)
                              : "—"}
                            <small className="table-note">
                              {positionLabel(game.position)}
                            </small>
                          </>
                        )}
                      </td>
                      <td>
                        {game.kills ?? "—"} / {game.deaths ?? "—"} /{" "}
                        {game.assists ?? "—"}
                      </td>
                      <td>{formatDuration(game.durationMs)}</td>
                      <td>
                        <Link href={`/games/${game.id}`}>상세 →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pageCount > 1 ? (
              <nav className="cta-row" aria-label="모임원 전적 페이지">
                {page > 1 ? (
                  <Link
                    href={`/members/${id}?page=${page - 1}`}
                    className="button button-secondary"
                  >
                    ← 이전
                  </Link>
                ) : null}
                {page < pageCount ? (
                  <Link
                    href={`/members/${id}?page=${page + 1}`}
                    className="button button-secondary"
                  >
                    다음 →
                  </Link>
                ) : null}
              </nav>
            ) : null}
          </>
        )}
      </section>
    </section>
  );
}
