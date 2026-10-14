import type { GameListWithParticipants } from "@/lib/games";
import { memberGameFixture } from "./member-history";

/** Synthetic people only; used for render regressions and local previews. */
export function gameListFixture(
  overrides: Partial<GameListWithParticipants> = {},
): GameListWithParticipants {
  const history = memberGameFixture();
  const names = [
    "김민수",
    "이서연",
    "박지훈",
    "최유진",
    null,
    "정도현",
    "한지우",
    null,
    "윤수빈",
    "장하늘",
  ];
  return {
    id: history.id,
    playedAt: history.playedAt,
    playedAtSource: history.playedAtSource,
    durationMs: history.durationMs,
    winningTeam: 100,
    participantCount: 10,
    comment: "수요일 내전 · 마지막 한타 역전승",
    participants: history.participants.map((player, index) => ({
      id: player.id,
      team: player.team,
      position: player.position,
      champion: player.champion,
      gameName: player.gameName,
      tagLine: player.tagLine,
      memberId: names[index]
        ? `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
        : null,
      memberName: names[index],
    })),
    ...overrides,
  };
}
