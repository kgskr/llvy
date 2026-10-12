import Link from "next/link";
import { redirect } from "next/navigation";

import { resolveSearchMember } from "@/lib/nickname-search";
import { UnauthorizedError } from "@/lib/auth-errors";
import { riotId } from "@/lib/format";
import {
  parseSearchInput,
  searchPageHref,
  type SearchParameters,
} from "@/lib/search-contract";
import { parsePageNumber } from "@/lib/validation";
import { NicknameSearchForm } from "../nickname-search-form";

export const dynamic = "force-dynamic";

export default async function NicknameSearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParameters>;
}) {
  const params = await searchParams;
  const search = parseSearchInput(params);
  let resolution;
  try {
    resolution = await resolveSearchMember(
      search,
      parsePageNumber(params.page),
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect("/login");
    throw error;
  }
  if (resolution.kind === "member") redirect(`/members/${resolution.memberId}`);
  if (resolution.kind === "missing" || !search) redirect("/search/not-found");
  return (
    <section className="stack">
      <div>
        <h1>모임원 검색 결과</h1>
        <p className="muted">
          이름이나 닉네임이 일치하는 모임원이 여러 명입니다. 연결된 계정을
          확인해 선택하세요.
        </p>
      </div>
      <NicknameSearchForm key={search.input} initialQuery={search.input} />
      <p className="muted">
        {resolution.total}명 · {resolution.page} / {resolution.pageCount}페이지
      </p>
      <ul className="nickname-results">
        {resolution.members.map((member) => (
          <li key={member.id} className="card">
            <Link href={`/members/${member.id}`}>
              <strong>{member.name}</strong>
              <span className="table-note">
                {member.accounts.length
                  ? member.accounts
                      .map((account) =>
                        riotId(account.gameName, account.tagLine),
                      )
                      .join(" · ")
                  : "연결된 계정 없음"}
              </span>
              <span className="table-note">전적 보기 →</span>
            </Link>
          </li>
        ))}
      </ul>
      {resolution.pageCount > 1 ? (
        <nav className="cta-row" aria-label="검색 결과 페이지">
          {resolution.page > 1 ? (
            <Link
              className="button button-secondary"
              href={searchPageHref(search, resolution.page - 1)}
            >
              ← 이전
            </Link>
          ) : null}
          {resolution.page < resolution.pageCount ? (
            <Link
              className="button button-secondary"
              href={searchPageHref(search, resolution.page + 1)}
            >
              다음 →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}
