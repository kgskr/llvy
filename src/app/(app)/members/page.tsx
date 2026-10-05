import Link from "next/link";

import { riotId } from "@/lib/format";
import { listMembersWithAccounts } from "@/lib/members";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const members = await listMembersWithAccounts();

  return (
    <section className="stack">
      <div className="page-heading">
        <div>
          <h1>모임원 정보</h1>
          <p className="muted">
            연결된 라이엇 계정의 전적을 한곳에서 확인하세요.
          </p>
        </div>
        <Link href="/admin" className="button button-secondary">
          모임원·계정 관리
        </Link>
      </div>
      {members.length === 0 ? (
        <div className="card empty-state">
          <p>아직 등록된 모임원이 없습니다.</p>
          <Link href="/admin">모임원 추가하기 →</Link>
        </div>
      ) : (
        <div className="member-grid">
          {members.map((member) => (
            <article key={member.id} className="card stack">
              <h2>
                <Link href={`/members/${member.id}`}>
                  {member.name}
                  {member.birthYear === null ? "" : `(${member.birthYear})`}
                </Link>
              </h2>
              {member.accounts.length > 0 ? (
                <ul className="account-list">
                  {member.accounts.map((account) => (
                    <li key={account.id}>
                      {riotId(account.gameName, account.tagLine)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">연결된 계정이 없습니다.</p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
