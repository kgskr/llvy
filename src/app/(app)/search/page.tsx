import Link from "next/link";
import { redirect } from "next/navigation";

import { resolveNicknameMember } from "@/lib/nickname-search";
import { UnauthorizedError } from "@/lib/auth-errors";
import { riotId } from "@/lib/format";
import { NicknameSearchForm } from "../nickname-search-form";

export const dynamic = "force-dynamic";

export default async function NicknameSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ nickname?: string | string[] }>;
}) {
  const { nickname } = await searchParams;
  const input = typeof nickname === "string" ? nickname : "";
  let resolution;
  try {
    resolution = await resolveNicknameMember(input);
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect("/login");
    throw error;
  }
  if (resolution.kind === "member") redirect(`/members/${resolution.memberId}`);
  if (resolution.kind === "missing") redirect("/search/not-found");
  return (
    <section className="stack">
      <div>
        <h1>닉네임 검색 결과</h1>
        <p className="muted">
          같은 닉네임의 모임원이 여러 명입니다. 태그를 확인해 선택하세요.
        </p>
      </div>
      <NicknameSearchForm initialNickname={input} />
      <ul className="nickname-results">
        {resolution.accounts.map((account) => (
          <li key={account.id} className="card">
            <Link href={`/members/${account.memberId}`}>
              <strong>{riotId(account.gameName, account.tagLine)}</strong>
              <span className="table-note">
                {account.memberName}의 전적 보기 →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
