import type { MemberHistoryGame } from "@/lib/member-history";

/** Synthetic display data, shared by render checks and temporary previews. */
export function memberGameFixture(
  overrides: Partial<MemberHistoryGame> = {},
): MemberHistoryGame {
  const champions = [
    "Garen",
    "LeeSin",
    "Ahri",
    "Ashe",
    "Thresh",
    "Darius",
    "Viego",
    "Orianna",
    "Jinx",
    "Lulu",
  ];
  const names = [
    "구름 위 산책",
    "새벽의 정글",
    "오늘도 즐겁게",
    "별빛 궁수",
    "함께하는 봇",
    "주말의 탑",
    "여유로운 한 판",
    "아주 긴 닉네임도 자연스럽게 표시",
    "파란 바다",
    "숲속 친구",
  ];
  return {
    id: "00000000-0000-4000-8000-000000000001",
    playedAt: "2026-10-14",
    playedAtSource: "file_mtime",
    durationMs: 1810000,
    champion: "Ahri",
    position: "MIDDLE",
    kills: 8,
    deaths: 2,
    assists: 11,
    result: "win",
    ambiguous: false,
    gameVersion: "16.19.1.1",
    level: 17,
    items: [3020, 3118, 3089, 3135, 3157, 0, 3364],
    participants: champions.map((champion, index) => ({
      id: `participant-${index}`,
      team: index < 5 ? 100 : 200,
      position: ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"][index % 5],
      champion,
      gameName: names[index],
      tagLine: "KR1",
      memberId:
        index === 2 || index === 8
          ? `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
          : null,
      memberName: index === 2 ? "김민수" : index === 8 ? "이서연" : null,
      isMember: index === 2,
    })),
    ...overrides,
  };
}
