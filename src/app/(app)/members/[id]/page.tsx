import { canManage, canUpload } from "@/lib/capabilities";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AssetIcon } from "@/app/(app)/asset-icon";
import {
  resolveChampionNames,
  resolveChampionPortraits,
} from "@/lib/champions";
import { positionLabel, riotId } from "@/lib/format";
import { resolveMemberGameAssets } from "@/lib/member-game-assets";
import { RecentGames } from "./recent-games";
import { RelationshipHighlights } from "./relationship-highlights";
import { getMemberHistoryReadModel } from "@/lib/read-model";
import { parsePageNumber } from "@/lib/validation";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

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
  const { history, role } = await getMemberHistoryReadModel(
    id,
    PAGE_SIZE,
    (page - 1) * PAGE_SIZE,
  );
  if (!history) notFound();
  const isAdmin = canManage(role);
  const pageCount = Math.max(
    1,
    Math.ceil(history.stats.totalGames / PAGE_SIZE),
  );
  if (page > pageCount) redirect(`/members/${id}?page=${pageCount}`);

  const {
    member,
    accounts,
    stats,
    games,
    championStats,
    positionStats,
    relationshipStats,
  } = history;
  const champions = championStats.map((summary) => summary.champion);
  const [championNames, championPortraits, recentAssets] = await Promise.all([
    champions.length
      ? resolveChampionNames(champions)
      : new Map<string, string>(),
    champions.length
      ? resolveChampionPortraits(champions)
      : new Map<string, string>(),
    resolveMemberGameAssets(games),
  ]);

  return (
    <section className="stack">
      <div>
        <p className="muted">
          <Link href="/members">← 모임원 목록</Link>
        </p>
        <h1>{member.name}의 전적</h1>
        <p className="muted">연결된 계정 {accounts.length}개</p>
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
                  <th scope="col">포지션</th>
                  <th scope="col">경기 수</th>
                  <th scope="col">승 / 패 / 미정</th>
                  <th scope="col">승률</th>
                  <th scope="col">평균 K / D / A</th>
                </tr>
              </thead>
              <tbody>
                {championStats.map((summary) => (
                  <tr
                    key={JSON.stringify([summary.champion, summary.position])}
                  >
                    <th scope="row">
                      <span className="game-champion">
                        <AssetIcon
                          src={championPortraits.get(summary.champion)}
                          label="챔피언 초상화"
                          decorative
                        />
                        {championNames.get(summary.champion) ??
                          summary.champion}
                      </span>
                    </th>
                    <td>{positionLabel(summary.position)}</td>
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
          연결된 모든 계정의 전체 전적을 챔피언·포지션별로 집계합니다. 포지션을
          확인할 수 없으면 ‘불명’으로 표시하며, 챔피언을 확인할 수 없는 경기와
          계정 중복 연결 경기는 제외합니다.
        </p>
      </section>

      <section className="card stack">
        <h2>플레이 포지션</h2>
        {positionStats.length === 0 ? (
          <p className="muted">집계할 포지션 전적이 없습니다.</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">포지션</th>
                  <th scope="col">플레이 횟수</th>
                  <th scope="col">승률</th>
                </tr>
              </thead>
              <tbody>
                {positionStats.map((summary) => (
                  <tr key={JSON.stringify(summary.position)}>
                    <th scope="row">{positionLabel(summary.position)}</th>
                    <td>{summary.totalGames.toLocaleString()}회</td>
                    <td>
                      {summary.winRate === null
                        ? "—"
                        : `${summary.winRate.toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="form-note">
          연결된 모든 계정의 전체 활성 전적을 포지션별로 집계합니다. 승률은
          승패가 결정된 경기 기준이며, 포지션 미확인은 ‘불명’으로 표시합니다.
          계정 중복 연결 경기는 제외합니다.
        </p>
      </section>

      <RelationshipHighlights highlights={relationshipStats} />

      <section className="card stack">
        <h2>연결된 라이엇 계정</h2>
        {accounts.length > 0 ? (
          <ul className="account-list">
            {accounts.map((account) => (
              <li key={account.id}>
                {account.tagLine ? (
                  <a
                    href={`https://op.gg/ko/lol/summoners/kr/${encodeURIComponent(account.gameName)}-${encodeURIComponent(account.tagLine)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${riotId(account.gameName, account.tagLine)} OP.GG 전적 보기 (새 탭)`}
                  >
                    {riotId(account.gameName, account.tagLine)}
                  </a>
                ) : (
                  riotId(account.gameName, account.tagLine)
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            계정을 연결하면 이미 저장된 경기의 전적도 표시됩니다.
          </p>
        )}
        {isAdmin ? <Link href="/admin">계정 연결 관리 →</Link> : null}
      </section>

      <section className="stack">
        <h2>최근 경기</h2>
        {games.length === 0 ? (
          <p className="empty-state">
            집계할 경기가 없습니다.
            {canUpload(role) ? (
              <>
                {" "}
                <Link href="/upload">리플레이 업로드 →</Link>
              </>
            ) : null}
          </p>
        ) : (
          <>
            <p className="muted">
              {page} / {pageCount}페이지
            </p>
            <RecentGames
              games={games}
              assetsByVersion={recentAssets}
              isAdmin={isAdmin}
            />
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
