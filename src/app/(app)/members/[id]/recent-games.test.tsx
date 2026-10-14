import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { memberGameFixture } from "@/test/member-history";
import { RecentGames } from "./recent-games";

const assets = new Map([
  [
    "16.19.1.1",
    {
      champions: new Map([
        [
          "Ahri",
          {
            name: "아리",
            iconUrl:
              "https://ddragon.leagueoflegends.com/cdn/16.19.1/img/champion/Ahri.png",
          },
        ],
      ]),
      items: new Map([
        [
          3020,
          {
            name: "마법사의 신발",
            iconUrl:
              "https://ddragon.leagueoflegends.com/cdn/16.19.1/img/item/3020.png",
          },
        ],
      ]),
    },
  ],
]);

it("renders the member loadout, both ordered rosters and neutral outcome labels", () => {
  const game = memberGameFixture();
  game.participants.reverse();
  const html = renderToStaticMarkup(
    <RecentGames games={[game]} assetsByVersion={assets} isAdmin={false} />,
  );
  expect(html).toContain("member-game-win");
  expect(html).not.toContain("badge");
  expect(html).toContain('aria-label="레벨 17"');
  expect(html).toContain("8 / 2 / 11");
  expect(html).toContain("9.50 KDA");
  expect(html).toContain("30분 10초");
  expect(html).toContain("2026. 10. 14.");
  expect(html).toContain('aria-label="블루 팀"');
  expect(html).toContain('aria-label="레드 팀"');
  expect(html.match(/class="member-game-player"/g)).toHaveLength(10);
  expect(html.indexOf("구름 위 산책")).toBeLessThan(
    html.indexOf("새벽의 정글"),
  );
  expect(html).toContain("현재 모임원");
  expect(html).toContain('aria-label="아이템 1: 마법사의 신발"');
  expect(html).toContain('aria-label="아이템 6: 빈 슬롯"');
  expect(html).toContain('aria-label="장신구: 아이템 3364"');
  expect(html).toContain(`href="/games/${game.id}"`);
});

it("links member names in both teams and leaves unlinked Riot IDs as text", () => {
  const game = memberGameFixture();
  const html = renderToStaticMarkup(
    <RecentGames games={[game]} assetsByVersion={assets} isAdmin={false} />,
  );
  const links = html.match(/<a\b[^>]*href="\/members\/[^>]*>.*?<\/a>/g) ?? [];
  expect(links).toHaveLength(2);
  expect(links[0]).toContain(
    `href="/members/${game.participants[2].memberId}"`,
  );
  expect(links[0]).toContain(">김민수<span");
  expect(links[0]).toContain("현재 모임원");
  expect(links[1]).toContain(
    `href="/members/${game.participants[8].memberId}"`,
  );
  expect(links[1]).toContain(">이서연</a>");
  expect(html).not.toContain("오늘도 즐겁게");
  expect(html).not.toContain("파란 바다");
  expect(html).toMatch(
    /<span class="member-game-player"[^>]*>구름 위 산책#KR1<\/span>/,
  );
  expect(html).not.toMatch(/href="\/members\/(?:null|undefined)"/);
});

it.each([false, true])(
  "retains ambiguous warnings, missing stats and unknown teams (admin: %s)",
  (isAdmin) => {
    const game = memberGameFixture({
      result: "unknown",
      ambiguous: true,
      champion: null,
      level: null,
      kills: null,
      deaths: null,
      assists: null,
      items: Array(7).fill(null),
    });
    game.participants[0].team = null;
    const html = renderToStaticMarkup(
      <RecentGames
        games={[game]}
        assetsByVersion={new Map()}
        isAdmin={isAdmin}
      />,
    );
    expect(html).toContain("member-game-unknown");
    expect(html).toContain("레벨 정보 없음");
    expect(html).toContain("KDA 정보 없음");
    expect(html).toContain("팀 미확인");
    expect(html).toContain("구름 위 산책");
    expect(html).toContain("계정 중복 연결 확인");
    expect(html.includes('href="/admin"')).toBe(isAdmin);
    expect(html.match(/class="member-game-player"/g)).toHaveLength(10);
  },
);

it("handles zero deaths without dividing by zero", () => {
  const html = renderToStaticMarkup(
    <RecentGames
      games={[memberGameFixture({ result: "loss", deaths: 0 })]}
      assetsByVersion={assets}
      isAdmin={false}
    />,
  );
  expect(html).toContain("member-game-loss");
  expect(html).toContain("Perfect KDA");
  expect(html).not.toMatch(/Infinity|NaN/);
});
