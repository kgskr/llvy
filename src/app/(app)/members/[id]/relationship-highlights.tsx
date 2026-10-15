import Link from "next/link";

import type {
  MemberRelationshipHighlight,
  MemberRelationshipKind,
} from "@/lib/member-relationships";

const categories: {
  kind: MemberRelationshipKind;
  label: string;
  rate: boolean;
}[] = [
  { kind: "allyWinRate", label: "같은 팀 최고 승률", rate: true },
  { kind: "opponentWinRate", label: "상대 팀 최고 승률", rate: true },
  { kind: "allyGames", label: "가장 많이 함께한 팀원", rate: false },
  { kind: "opponentGames", label: "가장 많이 만난 상대", rate: false },
];

export function RelationshipHighlights({
  highlights,
}: {
  highlights: MemberRelationshipHighlight[];
}) {
  if (highlights.length === 0) return null;

  return (
    <section className="stack" aria-label="함께한 모임원">
      <dl className="relationship-grid">
        {categories.map(({ kind, label, rate }) => {
          const entry = highlights.find((highlight) => highlight.kind === kind);
          if (!entry) return null;
          return (
            <div className="card relationship-card" key={kind}>
              <dt>{label}</dt>
              <dd>
                <Link href={`/members/${entry.memberId}`} prefetch={false}>
                  {entry.memberName}
                </Link>
                <span className="relationship-value">
                  {rate
                    ? `${entry.winRate!.toFixed(1)}%`
                    : `${entry.totalGames.toLocaleString()}경기`}
                </span>
                <span className="relationship-record">
                  {rate ? `${entry.totalGames.toLocaleString()}경기 · ` : ""}
                  {entry.wins}승 {entry.losses}패
                  {entry.undecided > 0 ? ` ${entry.undecided}미정` : ""}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="form-note">
        같은 팀·상대 팀 각각 3경기 이상인 모임원 기준입니다. 승률은 이 모임원
        관점에서 승패가 결정된 경기만 계산합니다.
      </p>
    </section>
  );
}
