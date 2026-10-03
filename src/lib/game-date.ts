const KOREA_OFFSET_MS = 9 * 60 * 60 * 1000;
export const GAME_DATE_FUTURE_LIMIT_MS = 24 * 60 * 60 * 1000;
export const MIN_GAME_DATE_INPUT = "2009-01-01T00:00";

/** datetime-local is interpreted as Korea time, regardless of browser timezone. */
export function formatKoreaDateInput(value: Date): string {
  return new Date(value.getTime() + KOREA_OFFSET_MS).toISOString().slice(0, 16);
}

export function playedAtSourceLabel(source: string): string {
  if (source === "manual") return "직접 수정";
  if (source === "file_mtime") return "파일 시각 추정";
  if (source === "upload") return "업로드 시각 추정";
  return "출처 불명";
}

type GameDateInput = { ok: true; date: Date } | { ok: false; error: string };

export function validateGameDateInput(
  value: unknown,
  now = new Date(),
): GameDateInput {
  if (typeof value !== "string" || !value) {
    return { ok: false, error: "경기 날짜와 시간을 입력하세요." };
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return {
      ok: false,
      error: "경기 날짜를 한국 시간 기준 연월일과 시·분으로 입력하세요.",
    };
  }
  const [, year, month, day, hour, minute] = match.map(Number);
  if (year < 2009) {
    return {
      ok: false,
      error: "경기 날짜는 2009년 1월 1일 이후로 입력하세요.",
    };
  }
  const date = new Date(
    Date.UTC(year, month - 1, day, hour, minute) - KOREA_OFFSET_MS,
  );
  // Date.UTC normalizes impossible calendar dates; require an exact round trip.
  if (
    !Number.isFinite(date.getTime()) ||
    formatKoreaDateInput(date) !== value
  ) {
    return { ok: false, error: "실제로 존재하는 날짜와 시간을 입력하세요." };
  }
  if (date.getTime() > now.getTime() + GAME_DATE_FUTURE_LIMIT_MS) {
    return {
      ok: false,
      error: "경기 날짜는 현재부터 24시간 이내까지만 입력할 수 있습니다.",
    };
  }
  return { ok: true, date };
}
