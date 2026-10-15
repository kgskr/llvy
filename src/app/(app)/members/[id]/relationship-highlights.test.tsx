import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type {
  MemberRelationshipHighlight,
  MemberRelationshipKind,
} from "@/lib/member-relationships";
import { RelationshipHighlights } from "./relationship-highlights";

vi.mock("next/link", () => ({
  default: ({
    prefetch,
    ...props
  }: React.ComponentProps<"a"> & { prefetch?: boolean }) => {
    expect(prefetch).toBe(false);
    return <a {...props} />;
  },
}));

const kinds: MemberRelationshipKind[] = [
  "allyWinRate",
  "opponentWinRate",
  "allyGames",
  "opponentGames",
];
const fixture = (
  kind: MemberRelationshipKind,
): MemberRelationshipHighlight => ({
  kind,
  memberId: "00000000-0000-4000-8000-000000000001",
  memberName: "함께한 친구",
  totalGames: 4,
  wins: 2,
  losses: 1,
  undecided: 1,
  winRate: 200 / 3,
});

it("renders the four ordered blocks in one row with member links and sample sizes", () => {
  const html = renderToStaticMarkup(
    <RelationshipHighlights highlights={kinds.toReversed().map(fixture)} />,
  );
  expect(html.match(/class="relationship-grid"/g)).toHaveLength(1);
  expect(html.match(/class="card relationship-card"/g)).toHaveLength(4);
  expect(
    html.match(/href="\/members\/00000000-0000-4000-8000-000000000001"/g),
  ).toHaveLength(4);
  const labels = [
    "같은 팀 최고 승률",
    "상대 팀 최고 승률",
    "가장 많이 함께한 팀원",
    "가장 많이 만난 상대",
  ];
  expect(labels.map((label) => html.indexOf(label))).toEqual(
    labels.map((label) => html.indexOf(label)).toSorted((a, b) => a - b),
  );
  expect(html).toContain("66.7%");
  expect(html).toContain("4경기 · 2승 1패 1미정");
});

it("omits missing blocks and renders a zero-percent value", () => {
  const entry = {
    ...fixture("opponentWinRate"),
    wins: 0,
    losses: 4,
    undecided: 0,
    winRate: 0,
  };
  const html = renderToStaticMarkup(
    <RelationshipHighlights highlights={[entry]} />,
  );
  expect(html.match(/class="card relationship-card"/g)).toHaveLength(1);
  expect(html).toContain("0.0%");
  expect(html).not.toContain("같은 팀 최고 승률");
  expect(html).not.toContain("가장 많이 함께한 팀원");
  expect(html).not.toContain("가장 많이 만난 상대");
});

it("renders unknown-outcome frequency without inventing a win rate", () => {
  const html = renderToStaticMarkup(
    <RelationshipHighlights
      highlights={[
        {
          ...fixture("allyGames"),
          wins: 0,
          losses: 0,
          undecided: 4,
          winRate: null,
        },
      ]}
    />,
  );
  expect(html).toContain("4경기");
  expect(html).toContain("0승 0패 4미정");
  expect(html).not.toContain("%");
});

it("omits the whole region including notes when no category qualifies", () => {
  expect(renderToStaticMarkup(<RelationshipHighlights highlights={[]} />)).toBe(
    "",
  );
});
