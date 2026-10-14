import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TeamBlock } from "./participant-table";

describe("game detail icon columns", () => {
  it("keeps seven ordered slots, accessible names, champion text and member links", () => {
    const html = renderToStaticMarkup(
      <TeamBlock
        title="블루 팀"
        result="win"
        players={[
          {
            id: "participant",
            team: 100,
            position: "MIDDLE",
            champion: "Ahri",
            win: true,
            kills: 10,
            deaths: 2,
            assists: 7,
            goldEarned: 15000,
            gameName: "플레이어",
            tagLine: "KR1",
            memberId: "member",
            memberName: "모임원",
            items: [3158, 0, null, 9999, 3158, 0, 3340],
          },
        ]}
        assets={{
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
              3158,
              {
                name: "명석함의 아이오니아 장화",
                iconUrl:
                  "https://ddragon.leagueoflegends.com/cdn/16.19.1/img/item/3158.png",
              },
            ],
            [
              3340,
              {
                name: "투명 와드",
                iconUrl:
                  "https://ddragon.leagueoflegends.com/cdn/16.19.1/img/item/3340.png",
              },
            ],
          ]),
        }}
      />,
    );
    expect(html).toContain("<th>아이템</th>");
    expect(html).toContain("아리</span>");
    expect(html).toContain("/img/champion/Ahri.png");
    expect(html.match(/role="img"/g)).toHaveLength(7);
    expect(html).toContain('aria-label="아이템 2: 빈 슬롯"');
    expect(html).toContain('aria-label="아이템 3: 정보 없음"');
    expect(html).toContain('aria-label="아이템 4: 아이템 9999"');
    expect(html).toContain('aria-label="장신구: 투명 와드"');
    expect(html.indexOf('aria-label="아이템 6:')).toBeLessThan(
      html.indexOf('aria-label="장신구:'),
    );
    expect(html).not.toContain(">명석함의 아이오니아 장화<");
    expect(html).toContain('href="/members/member"');
    expect(html).toContain("10 / 2 / 7");
    expect(html).toContain("table-scroll");
  });
});
