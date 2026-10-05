import Link from "next/link";

import { getGameListReadModel } from "@/lib/read-model";
import { formatGameDate, formatDuration, teamLabel } from "@/lib/format";
import { playedAtSourceLabel } from "@/lib/game-date";

import { GameFeedbackProvider, GameVisibilityForm } from "./forms";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function GamesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[]; view?: string | string[] }>;
}) {
  const { page: requestedPage, view } = await searchParams;
  const visibility = view === "excluded" ? "excluded" : "active";
  const excluded = visibility === "excluded";
  const { total, role, pageCount, page, games } = await getGameListReadModel(
    PAGE_SIZE,
    requestedPage,
    visibility,
  );
  const isAdmin = role !== "viewer";
  const canRestore = excluded && isAdmin;
  const viewQuery = excluded ? "view=excluded&" : "";

  return (
    <section className="stack">
      <h1>게임</h1>
      <nav className="cta-row" aria-label="게임 목록 보기">
        <Link
          href={`/games?page=${page}`}
          className={`button${excluded ? " button-secondary" : ""}`}
          aria-current={!excluded ? "page" : undefined}
        >
          전체 기록
        </Link>
        <Link
          href={`/games?view=excluded&page=${page}`}
          className={`button${excluded ? "" : " button-secondary"}`}
          aria-current={excluded ? "page" : undefined}
        >
          제외된 경기
        </Link>
      </nav>
      <GameFeedbackProvider>
        {excluded ? (
          <p className="muted">
            제외된 경기는 기본 목록과 모임원 전적에 포함되지 않습니다. 복구하면
            다시 반영됩니다.
          </p>
        ) : null}
        <p className="muted">
          총 {total.toLocaleString()}경기 · {page} / {pageCount}페이지
        </p>
        {games.length === 0 ? (
          <p className="empty-state">
            {excluded ? "제외된 경기가 없습니다." : "표시할 경기가 없습니다."}
            {!excluded && isAdmin ? (
              <>
                {" "}
                <Link href="/upload">리플레이 업로드 →</Link>
              </>
            ) : null}
          </p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>게임 날짜</th>
                  <th>길이</th>
                  <th>승리 팀</th>
                  <th>인원</th>
                  <th>코멘트</th>
                  <th />
                  {canRestore ? <th>복구</th> : null}
                </tr>
              </thead>
              <tbody>
                {games.map((game) => (
                  <tr key={game.id}>
                    <td>
                      {formatGameDate(game.playedAt)}
                      <span className="muted">
                        {" "}
                        ({playedAtSourceLabel(game.playedAtSource)})
                      </span>
                    </td>
                    <td>{formatDuration(game.durationMs)}</td>
                    <td>{teamLabel(game.winningTeam)}</td>
                    <td>{game.participantCount}</td>
                    <td
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {game.comment ?? "—"}
                    </td>
                    <td>
                      <Link
                        href={`/games/${game.id}?view=${visibility}&page=${page}`}
                      >
                        상세 →
                      </Link>
                    </td>
                    {canRestore ? (
                      <td>
                        <GameVisibilityForm gameId={game.id} excluded />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pageCount > 1 ? (
          <nav className="cta-row" aria-label="게임 목록 페이지">
            {page > 1 ? (
              <Link
                href={`/games?${viewQuery}page=${page - 1}`}
                className="button button-secondary"
              >
                ← 이전
              </Link>
            ) : null}
            {page < pageCount ? (
              <Link
                href={`/games?${viewQuery}page=${page + 1}`}
                className="button button-secondary"
              >
                다음 →
              </Link>
            ) : null}
          </nav>
        ) : null}
      </GameFeedbackProvider>
    </section>
  );
}
