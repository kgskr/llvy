const KOREA_OFFSET_MS = 9 * 60 * 60 * 1000;
export const GAME_DATE_FUTURE_LIMIT_MS = 24 * 60 * 60 * 1000;
export const MIN_GAME_DATE_INPUT = "2009-01-01";

/** Convert an instant into the Korea calendar day used in game storage. */
export function formatKoreaDateInput(value: Date): string {
  return new Date(value.getTime() + KOREA_OFFSET_MS).toISOString().slice(0, 10);
}

export function playedAtSourceLabel(source: string): string {
  if (source === "manual") return "직접 수정";
  if (source === "file_mtime") return "파일 날짜 추정";
  if (source === "upload") return "업로드 날짜 추정";
  return "출처 불명";
}

type GameDateInput = { ok: true; date: string } | { ok: false; error: string };

export function validateGameDateInput(
  value: unknown,
  now = new Date(),
): GameDateInput {
  if (typeof value !== "string" || !value) {
    return { ok: false, error: "경기 날짜를 입력하세요." };
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return {
      ok: false,
      error: "경기 날짜를 연월일로 입력하세요.",
    };
  }
  const [, year, month, day] = match.map(Number);
  if (year < 2009) {
    return {
      ok: false,
      error: "경기 날짜는 2009년 1월 1일 이후로 입력하세요.",
    };
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC normalizes impossible calendar dates; require an exact round trip.
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    return { ok: false, error: "실제로 존재하는 날짜를 입력하세요." };
  }
  if (
    value >
    formatKoreaDateInput(new Date(now.getTime() + GAME_DATE_FUTURE_LIMIT_MS))
  ) {
    return {
      ok: false,
      error: "경기 날짜는 한국 날짜 기준 내일까지 입력할 수 있습니다.",
    };
  }
  return { ok: true, date: value };
}
