import Link from "next/link";
import { redirect } from "next/navigation";

import { listAuditLogs } from "@/lib/audit";
import { formatDate } from "@/lib/format";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const ACTION_LABELS: Record<string, string> = {
  "auth.login": "로그인",
  "auth.logout": "로그아웃",
  "admin.granted": "관리자 지정",
  "admin.revoked": "관리자 지정 취소",
  "member.created": "모임원 등록",
  "member.updated": "모임원 정보 수정",
  "member.deleted": "모임원 삭제",
  "account.linked": "라이엇 계정 연결",
  "account.unlinked": "라이엇 계정 연결 해제",
  "game.date_updated": "게임 날짜 수정",
  "game.date_restored": "게임 날짜 복원",
  "game.excluded": "게임 제외",
  "game.restored": "게임 복구",
  "game.comment_updated": "게임 코멘트 수정",
  "replay.reserved": "리플레이 업로드 예약",
  "replay.processed": "리플레이 처리",
};
const ROLE_LABELS: Record<string, string> = {
  viewer: "일반 사용자",
  admin: "관리자",
  owner: "서비스 오너",
};
const RESULT_LABELS: Record<string, string> = {
  success: "성공",
  failure: "실패",
  duplicate: "중복",
};
const TARGET_LABELS: Record<string, string> = {
  member: "모임원",
  account: "라이엇 계정",
  game: "게임",
  upload: "업로드",
  session: "로그인 세션",
};
const CHANGE_LABELS: Record<string, string> = {
  name: "이름",
  birthYear: "생년",
  memberId: "연결 모임원",
  accountId: "라이엇 계정",
  playedAtOverride: "게임 날짜",
  excludedAt: "제외 시각",
  gameId: "게임",
  reason: "사유",
  administrator: "관리자 여부",
  comment: "코멘트",
};

function changeValue(value: unknown): string {
  if (value == null) return "없음";
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  return "—";
}

function changesRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function Changes({ before, after }: { before: unknown; after: unknown }) {
  const previous = changesRecord(before);
  const next = changesRecord(after);
  const keys = Object.keys(CHANGE_LABELS).filter(
    (key) => Object.hasOwn(previous, key) || Object.hasOwn(next, key),
  );
  if (!keys.length) return <span className="muted">—</span>;
  return (
    <ul className="account-list">
      {keys.map((key) => (
        <li key={key}>
          {CHANGE_LABELS[key]}: {changeValue(previous[key])} →{" "}
          {changeValue(next[key])}
        </li>
      ))}
    </ul>
  );
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login?redirectTo=%2Fadmin%2Faudit");
  if (session.role !== "owner")
    redirect(session.role === "admin" ? "/admin" : "/members");

  const params = await searchParams;
  const requestedPage =
    typeof params.page === "string" && /^[1-9]\d*$/.test(params.page)
      ? Number(params.page)
      : 1;
  const page =
    Number.isSafeInteger(requestedPage) &&
    Number.isSafeInteger((requestedPage - 1) * PAGE_SIZE)
      ? requestedPage
      : 1;
  const rows = await listAuditLogs(PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
  const hasNext = rows.length > PAGE_SIZE;
  const logs = rows.slice(0, PAGE_SIZE);

  return (
    <div className="stack">
      <div className="page-heading">
        <h1>감사로그</h1>
        <Link href="/admin" className="button button-secondary">
          모임원 관리
        </Link>
      </div>
      <p className="muted">
        데이터 변경과 로그인 사건을 최근 순서로 표시합니다. 관리자 실행자는 그
        비밀키를 발급받은 모임원입니다.
      </p>
      <section className="card stack" aria-label="감사 기록">
        {logs.length === 0 ? (
          <p className="muted">표시할 감사로그가 없습니다.</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">시각 (한국)</th>
                  <th scope="col">실행자</th>
                  <th scope="col">작업</th>
                  <th scope="col">대상</th>
                  <th scope="col">결과</th>
                  <th scope="col">변경 전 → 후</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td>
                      <time dateTime={log.occurredAt.toISOString()}>
                        {formatDate(log.occurredAt)}
                      </time>
                    </td>
                    <td>
                      {log.actorName ?? "인증되지 않은 사용자"}
                      {log.actorRole ? (
                        <span className="table-note">
                          {ROLE_LABELS[log.actorRole] ?? log.actorRole}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {ACTION_LABELS[log.action] ?? log.action}
                      <details className="table-note">
                        <summary>추적 정보</summary>
                        <dl>
                          <dt>요청 ID</dt>
                          <dd>{log.requestId}</dd>
                          <dt>로그 ID</dt>
                          <dd>{log.id}</dd>
                          {log.actorMemberId ? (
                            <>
                              <dt>실행 모임원 ID</dt>
                              <dd>{log.actorMemberId}</dd>
                            </>
                          ) : null}
                          {log.actorCredentialId ? (
                            <>
                              <dt>관리자 발급 ID</dt>
                              <dd>{log.actorCredentialId}</dd>
                            </>
                          ) : null}
                        </dl>
                      </details>
                    </td>
                    <td>
                      {TARGET_LABELS[log.targetType] ?? log.targetType}
                      {log.targetId ? (
                        <span className="table-note">{log.targetId}</span>
                      ) : null}
                    </td>
                    <td>
                      <span
                        className={
                          log.result === "failure"
                            ? "badge badge-loss"
                            : "badge badge-muted"
                        }
                      >
                        {RESULT_LABELS[log.result] ?? log.result}
                      </span>
                    </td>
                    <td>
                      <Changes before={log.before} after={log.after} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <nav className="link-form" aria-label="감사로그 페이지">
          {page > 1 ? (
            <Link
              href={`/admin/audit?page=${page - 1}`}
              className="button button-secondary"
            >
              이전
            </Link>
          ) : null}
          <span>{page}페이지</span>
          {hasNext ? (
            <Link
              href={`/admin/audit?page=${page + 1}`}
              className="button button-secondary"
            >
              다음
            </Link>
          ) : null}
        </nav>
      </section>
    </div>
  );
}
