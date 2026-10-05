const POSITION_LABELS: Record<string, string> = {
  TOP: "탑",
  JUNGLE: "정글",
  MIDDLE: "미드",
  BOTTOM: "바텀",
  UTILITY: "서폿",
};

export const POSITION_ORDER = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

export function positionLabel(position: string | null): string {
  if (!position) return "불명";
  return POSITION_LABELS[position] ?? position;
}

export function teamLabel(team: number | null): string {
  if (team === 100) return "블루";
  if (team === 200) return "레드";
  return "-";
}

export function formatDuration(ms: number | null): string {
  if (ms == null || ms < 0) return "-";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}분 ${seconds.toString().padStart(2, "0")}초`;
}

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

export function formatDate(value: Date): string {
  return dateFormatter.format(value);
}

/** Calendar dates have no timezone or time to format. */
export function formatGameDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${year}. ${Number(month)}. ${Number(day)}.`;
}

export function riotId(gameName: string, tagLine: string): string {
  return tagLine ? `${gameName}#${tagLine}` : gameName;
}
