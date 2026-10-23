import { canManage, ROLE_LABELS } from "@/lib/capabilities";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listLoginAccounts } from "@/lib/account-administration";
import { getAuthenticationMaintenanceStatus } from "@/lib/auth-maintenance";
import { getReadSession } from "@/lib/session";
import { formatDate } from "@/lib/format";
import { UploaderControls } from "./uploader-controls";
import { PermissionControls } from "./permission-controls";
export const dynamic = "force-dynamic";
const ROLES = ROLE_LABELS;
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const session = await getReadSession();
  if (!session) redirect("/login?redirectTo=%2Fadmin%2Fusers");
  if (!canManage(session.role)) redirect("/");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 64) : "";
  const requested =
    typeof params.page === "string" && /^[1-9]\d{0,6}$/.test(params.page)
      ? Number(params.page)
      : 1;
  const [initial, maintenance] = await Promise.all([
    listLoginAccounts(q, 50, (requested - 1) * 50),
    session.role === "owner"
      ? getAuthenticationMaintenanceStatus()
      : Promise.resolve(null),
  ]);
  const pages = Math.max(1, Math.ceil(initial.total / 50));
  const page = Math.min(requested, pages);
  const result =
    page === requested
      ? initial
      : await listLoginAccounts(q, 50, (page - 1) * 50);
  const href = (p: number) =>
    "/admin/users?" + new URLSearchParams({ q, page: String(p) });
  const statusLabels: Record<string, string> = {
    completed: "완료",
    partial: "일부 완료",
    running: "실행 중",
    idle: "실행 전",
  };
  return (
    <div className="stack">
      <div className="page-heading">
        <h1>사용자 권한</h1>
        <Link href="/admin">관리</Link>
      </div>
      <section className="card stack">
        <p>
          Discord 로그인으로 등록된 사용자입니다. 가입 여부는 하루 1회 정리하며
          업로더·관리자 권한 부여 시 다시 확인합니다.
        </p>
        {session.role === "owner" ? (
          <p className="muted">
            마지막 전체 정리:{" "}
            {maintenance?.lastCompletedAt
              ? formatDate(maintenance.lastCompletedAt)
              : "아직 없음"}{" "}
            ·{" "}
            {maintenance
              ? (statusLabels[maintenance.status] ?? maintenance.status)
              : "실행 전"}
            {maintenance
              ? " · 확인 " +
                maintenance.examined +
                "명 · 정지 " +
                maintenance.suspended +
                "명 · 오류 " +
                maintenance.failed +
                "회"
              : ""}
          </p>
        ) : null}
        <form method="get" className="link-form">
          <label htmlFor="user-search">사용자 검색</label>
          <input
            id="user-search"
            name="q"
            maxLength={64}
            defaultValue={q}
            placeholder="표시명, 사용자명, Discord ID"
          />
          <button type="submit">검색</button>
        </form>
        {result.accounts.length ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>사용자</th>
                  <th>최근 로그인</th>
                  <th>접근 상태</th>
                  <th>권한</th>
                  <th>마지막 가입 확인</th>
                  <th>권한 변경</th>
                </tr>
              </thead>
              <tbody>
                {result.accounts.map((account) => (
                  <tr key={account.id}>
                    <td>
                      {account.displayName}
                      <span className="table-note">{account.username}</span>
                      <span className="table-note">
                        {account.discordUserId}
                      </span>
                    </td>
                    <td>{formatDate(account.lastLoginAt)}</td>
                    <td>{account.status === "active" ? "활성" : "정지"}</td>
                    <td>{account.role ? ROLES[account.role] : "-"}</td>
                    <td>
                      {formatDate(account.membershipCheckedAt)}
                      <span className="table-note">
                        {account.membershipStatus === "member"
                          ? "가입 확인"
                          : account.membershipStatus === "pending"
                            ? "가입 심사 대기"
                            : "미가입"}
                      </span>
                    </td>
                    <td>
                      {account.role === "owner" ? (
                        "환경변수 지정"
                      ) : session.role === "owner" ? (
                        <PermissionControls
                          accountId={account.id}
                          administrator={!!account.grantId}
                          suspended={account.status !== "active"}
                        />
                      ) : null}
                      {account.role !== "owner" && !account.grantId ? (
                        <UploaderControls
                          accountId={account.id}
                          uploader={!!account.uploaderGrantId}
                          suspended={account.status !== "active"}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">등록된 사용자가 없습니다.</p>
        )}
        <nav className="link-form" aria-label="사용자 페이지">
          {page > 1 ? <Link href={href(page - 1)}>이전</Link> : null}
          <span>
            {page} / {pages}페이지 · 총 {result.total}명
          </span>
          {page < pages ? <Link href={href(page + 1)}>다음</Link> : null}
        </nav>
      </section>
    </div>
  );
}
