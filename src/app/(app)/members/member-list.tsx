"use client";

import Link from "next/link";
import { useState } from "react";

import { riotId } from "@/lib/format";

import { filterMembers } from "./member-filter";

type Member = {
  id: string;
  name: string;
  birthYear?: number | null;
  accounts: { id: string; gameName: string; tagLine: string }[];
};

export function MemberList({
  members,
  isAdmin,
}: {
  members: Member[];
  isAdmin: boolean;
}) {
  const [query, setQuery] = useState("");
  const visibleMembers = filterMembers(members, query);

  return (
    <section className="stack">
      <div className="member-heading">
        <h1>모임원 정보</h1>
        <div className="field member-search" role="search">
          <input
            type="search"
            aria-label="모임원 이름 또는 라이엇 ID 검색"
            aria-controls="member-list-results"
            placeholder="이름 또는 라이엇 ID"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {isAdmin ? (
          <Link
            href="/admin"
            prefetch={false}
            className="button button-secondary member-heading-action"
          >
            모임원·계정 관리
          </Link>
        ) : null}
        <p className="muted member-heading-description">
          연결된 라이엇 계정의 전적을 한곳에서 확인하세요.
        </p>
      </div>
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        모임원 {visibleMembers.length}명
      </p>
      <div id="member-list-results">
        {members.length === 0 ? (
          <div className="card empty-state">
            <p>아직 등록된 모임원이 없습니다.</p>
            {isAdmin ? (
              <Link href="/admin" prefetch={false}>
                모임원 추가하기 →
              </Link>
            ) : null}
          </div>
        ) : visibleMembers.length === 0 ? (
          <div className="card empty-state">
            <p>검색 결과가 없습니다.</p>
            <p className="muted">다른 이름이나 라이엇 ID로 검색해 보세요.</p>
          </div>
        ) : (
          <div className="member-grid">
            {visibleMembers.map((member) => (
              <article key={member.id} className="card stack">
                <h2>
                  <Link href={`/members/${member.id}`} prefetch={false}>
                    {member.name}
                    {member.birthYear == null ? "" : `(${member.birthYear})`}
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
      </div>
    </section>
  );
}
