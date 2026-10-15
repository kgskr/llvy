import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { gameListFixture } from "@/test/game-list";

vi.mock("next/link", () => ({
  default: ({
    prefetch,
    children,
    ...props
  }: {
    prefetch?: boolean;
    children: ReactNode;
  }) => (
    <a {...props} data-prefetch={String(prefetch)}>
      {children}
    </a>
  ),
}));
vi.mock("./forms", () => ({
  GameVisibilityForm: () => <button>경기 복구</button>,
}));

import { GameList } from "./game-list";

const portrait =
  "https://ddragon.leagueoflegends.com/cdn/16.19.1/img/champion/LeeSin.png";
const baseProps = {
  championNames: new Map([["LeeSin", "리 신"]]),
  championPortraits: new Map([["LeeSin", portrait]]),
  visibility: "active" as const,
  page: 2,
  canRestore: false,
};

it("shows ordered member names and unlinked Riot IDs beside portraits, with JUG and bounded navigation", () => {
  const game = gameListFixture();
  game.participants.reverse();
  const html = renderToStaticMarkup(<GameList {...baseProps} games={[game]} />);
  expect(html).toContain("game-list-blue");
  expect(html).toContain("블루 팀 승리");
  expect(html).toContain('aria-label="블루 팀"');
  expect(html).toContain('aria-label="레드 팀"');
  expect(html.match(/class="game-list-player"/g)).toHaveLength(10);
  expect(html).toContain(">JUG<");
  expect(html).not.toContain(">JG<");
  expect(html.indexOf("김민수")).toBeLessThan(html.indexOf("이서연"));
  expect(html.indexOf("이서연")).toBeLessThan(html.indexOf("박지훈"));
  expect(html).not.toContain("새벽의 정글");
  expect(html).toContain("함께하는 봇#KR1");
  expect(html).toContain("아주 긴 닉네임도 자연스럽게 표시#KR1");
  expect(html).toContain('aria-label="리 신"');
  expect(html.indexOf(portrait)).toBeLessThan(html.indexOf("이서연"));
  expect(html).toContain(`href="/games/${game.id}?view=active&amp;page=2"`);
  expect(html.match(/data-prefetch="false"/g)).toHaveLength(9);
  expect(html).not.toContain("경기 복구");
  expect(html).not.toContain("인원");
  expect(html).toContain("30분 10초");
});

it.each([false, true])(
  "preserves excluded restoration permission and red winner styling (restore: %s)",
  (canRestore) => {
    const html = renderToStaticMarkup(
      <GameList
        {...baseProps}
        games={[gameListFixture({ winningTeam: 200 })]}
        visibility="excluded"
        canRestore={canRestore}
      />,
    );
    expect(html).toContain("game-list-red");
    expect(html).toContain("레드 팀 승리");
    expect(html).toContain("?view=excluded&amp;page=2");
    expect(html.includes("경기 복구")).toBe(canRestore);
  },
);

it.each([100, 200, null, 300])(
  "labels each known team's outcome only when the winner is known (%s)",
  (winningTeam) => {
    const game = gameListFixture({ winningTeam });
    game.participants.push({
      ...game.participants[0],
      id: "unknown-team-player",
      team: null,
    });
    const html = renderToStaticMarkup(
      <GameList {...baseProps} games={[game]} />,
    );
    const knownWinner = winningTeam === 100 || winningTeam === 200;
    for (const [team, id] of [
      ["blue", 100],
      ["red", 200],
    ] as const) {
      const section = html.match(
        new RegExp(
          `<section class="game-list-team game-list-team-${team}"[\\s\\S]*?</section>`,
        ),
      )?.[0];
      expect(section).toBeDefined();
      if (knownWinner) {
        expect(section).toContain(
          `>${winningTeam === id ? "승리" : "패배"}</span>`,
        );
      } else {
        expect(section).not.toContain("game-list-team-result");
      }
    }
    const unknownTeam = html.match(
      /<section class="game-list-team game-list-team-unknown"[\s\S]*?<\/section>/,
    )?.[0];
    expect(unknownTeam).toBeDefined();
    expect(unknownTeam).not.toContain("game-list-team-result");
  },
);

it("keeps unknown teams, roles and image fallbacks without inventing a winner", () => {
  const game = gameListFixture({
    winningTeam: null,
    comment: "  <b>메모</b>\n  ",
  });
  game.participants = [
    { ...game.participants[0], team: null, position: null, champion: null },
  ];
  const html = renderToStaticMarkup(<GameList {...baseProps} games={[game]} />);
  expect(html).toContain("game-list-unknown");
  expect(html).toContain("승리 팀 미확인");
  expect(html).toContain("팀 미확인");
  expect(html).toContain(">불명<");
  expect(html).toContain('aria-label="챔피언 정보 없음"');
  expect(html.match(/참가자 정보 없음/g)).toHaveLength(2);
  expect(html).toContain("김민수");
  expect(html).toContain("  &lt;b&gt;메모&lt;/b&gt;\n  ");
  expect(html).not.toContain("<b>메모</b>");
});
