import Link from "next/link";
import { redirect } from "next/navigation";

import {
  countMembers,
  countUnlinkedAccounts,
  listMemberOptions,
  listMembersWithAccounts,
  listUnlinkedAccounts,
} from "@/lib/members";
import { riotId } from "@/lib/format";
import { getSession } from "@/lib/session";

import { CredentialControls } from "./credential-controls";

import {
  AdminFeedbackProvider,
  DeleteMemberForm,
  LinkAccountForm,
  MemberForm,
  UnlinkAccountForm,
} from "./forms";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

function clampedPage(
  value: string | string[] | undefined,
  total: number,
): number {
  const parsed =
    typeof value === "string" && /^[1-9]\d*$/.test(value) ? Number(value) : 1;
  const requested = Number.isSafeInteger(parsed) ? parsed : 1;
  return Math.min(requested, Math.max(1, Math.ceil(total / PAGE_SIZE)));
}

function Pagination({
  kind,
  page,
  total,
  memberPage,
  accountPage,
}: {
  kind: "members" | "accounts";
  page: number;
  total: number;
  memberPage: number;
  accountPage: number;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  function href(nextPage: number) {
    const nextMemberPage = kind === "members" ? nextPage : memberPage;
    const nextAccountPage = kind === "accounts" ? nextPage : accountPage;
    return `/admin?memberPage=${nextMemberPage}&accountPage=${nextAccountPage}`;
  }
  return (
    <nav
      className="link-form"
      aria-label={kind === "members" ? "모임원 페이지" : "미연결 계정 페이지"}
    >
      {page > 1 ? (
        <Link href={href(page - 1)} className="button button-secondary">
          이전
        </Link>
      ) : null}
      <span>
        {page} / {pages}페이지 · 총 {total}
        {kind === "members" ? "명" : "개"}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className="button button-secondary">
          다음
        </Link>
      ) : null}
    </nav>
  );
}

export default async function AdminPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<{
    memberPage?: string | string[];
    accountPage?: string | string[];
  }>;
} = {}) {
  const session = await getSession();
  if (!session) redirect("/login?redirectTo=%2Fadmin");
  if (session.role === "viewer") redirect("/members");

  const [params, memberTotal, accountTotal, memberOptions] = await Promise.all([
    searchParams,
    countMembers(),
    countUnlinkedAccounts(),
    listMemberOptions(),
  ]);
  const memberPage = clampedPage(params.memberPage, memberTotal);
  const accountPage = clampedPage(params.accountPage, accountTotal);
  const [members, unlinked] = await Promise.all([
    listMembersWithAccounts(PAGE_SIZE, (memberPage - 1) * PAGE_SIZE),
    listUnlinkedAccounts(PAGE_SIZE, (accountPage - 1) * PAGE_SIZE),
  ]);
  const currentYear = new Date().getFullYear();

  return (
    <div className="stack">
      <div className="page-heading">
        <h1>관리</h1>
        {session.role === "owner" ? (
          <Link href="/admin/audit" className="button button-secondary">
            감사로그
          </Link>
        ) : null}
      </div>
      <AdminFeedbackProvider>
        <section className="card stack">
          <h2>모임원 추가</h2>
          <MemberForm currentYear={currentYear} />
        </section>

        <section className="card stack">
          <h2>모임원 ({memberTotal}명)</h2>
          {members.length === 0 ? (
            <p className="muted">아직 등록된 모임원이 없습니다.</p>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>생년</th>
                    <th>연결된 라이엇 계정</th>
                    <th>정보 수정</th>
                    {session.role === "owner" ? <th>관리자 권한</th> : null}
                    <th>삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.id}>
                      <td>
                        <Link href={`/members/${member.id}`}>
                          {member.name}
                        </Link>
                      </td>
                      <td>{member.birthYear ?? "-"}</td>
                      <td>
                        {member.accounts.length === 0 ? (
                          <span className="muted">없음</span>
                        ) : (
                          <ul className="account-list">
                            {member.accounts.map((account) => (
                              <li key={account.id}>
                                {riotId(account.gameName, account.tagLine)}
                                <UnlinkAccountForm
                                  accountId={account.id}
                                  accountName={riotId(
                                    account.gameName,
                                    account.tagLine,
                                  )}
                                />
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td>
                        <details>
                          <summary>수정</summary>
                          <MemberForm
                            member={member}
                            currentYear={currentYear}
                          />
                        </details>
                      </td>
                      {session.role === "owner" ? (
                        <td>
                          <CredentialControls
                            memberId={member.id}
                            memberName={member.name}
                            administrator={member.administrator}
                          />
                        </td>
                      ) : null}
                      <td>
                        {member.administrator ? (
                          <p className="form-note">
                            활성 관리자는 삭제할 수 없습니다. 서비스 오너가
                            관리자 지정을 취소한 후 삭제하세요.
                          </p>
                        ) : (
                          <details>
                            <summary>삭제</summary>
                            <DeleteMemberForm
                              memberId={member.id}
                              memberName={member.name}
                            />
                          </details>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination
            kind="members"
            page={memberPage}
            total={memberTotal}
            memberPage={memberPage}
            accountPage={accountPage}
          />
        </section>

        <section className="card stack">
          <h2>미연결 라이엇 계정 ({accountTotal}개)</h2>
          <p className="muted">
            리플레이에서 발견했지만 아직 모임원에 연결되지 않은 계정입니다.
            제외되지 않은 게임에 참여한 계정만 표시하고 게임 수도 해당 게임만
            집계합니다. 연결하면 과거 게임의 참가자도 자동으로 해당 모임원으로
            표시됩니다.
          </p>
          {unlinked.length === 0 ? (
            <p className="muted">미연결 계정이 없습니다.</p>
          ) : memberOptions.length === 0 ? (
            <p className="form-note">연결하려면 먼저 모임원을 추가하세요.</p>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>라이엇 아이디</th>
                    <th>게임 수</th>
                    <th>모임원에 연결</th>
                  </tr>
                </thead>
                <tbody>
                  {unlinked.map((account) => (
                    <tr key={account.id}>
                      <td>{riotId(account.gameName, account.tagLine)}</td>
                      <td>{account.gameCount}</td>
                      <td>
                        <LinkAccountForm
                          accountId={account.id}
                          accountName={riotId(
                            account.gameName,
                            account.tagLine,
                          )}
                          members={memberOptions}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination
            kind="accounts"
            page={accountPage}
            total={accountTotal}
            memberPage={memberPage}
            accountPage={accountPage}
          />
        </section>
      </AdminFeedbackProvider>
    </div>
  );
}
