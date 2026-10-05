import { describe, expect, it } from "vitest";

import {
  formatKoreaDateInput,
  playedAtSourceLabel,
  validateGameDateInput,
} from "./game-date";

const NOW = new Date("2026-10-03T03:00:00.000Z");

describe("Korea calendar game date input", () => {
  it("accepts a date without introducing a time component", () => {
    expect(validateGameDateInput("2026-10-02", NOW)).toEqual({
      ok: true,
      date: "2026-10-02",
    });
  });

  it("allows the first day of 2009", () => {
    expect(validateGameDateInput("2009-01-01", NOW)).toEqual({
      ok: true,
      date: "2009-01-01",
    });
  });

  it("accepts leap days only in leap years", () => {
    expect(validateGameDateInput("2024-02-29", NOW).ok).toBe(true);
    expect(validateGameDateInput("2025-02-29", NOW).ok).toBe(false);
    expect(
      validateGameDateInput("2100-02-29", new Date("2100-03-01T00:00Z")).ok,
    ).toBe(false);
  });

  it("allows the whole Korea tomorrow and rejects the following day", () => {
    expect(validateGameDateInput("2026-10-04", NOW).ok).toBe(true);
    expect(validateGameDateInput("2026-10-05", NOW).ok).toBe(false);
    const koreaNextDay = new Date("2026-10-03T15:01:00Z");
    expect(validateGameDateInput("2026-10-05", koreaNextDay).ok).toBe(true);
    expect(validateGameDateInput("2026-10-06", koreaNextDay).ok).toBe(false);
  });

  it.each([
    "2008-12-31",
    "2026-00-01",
    "2026-13-01",
    "2026-04-31",
    "2026-02-00",
    "2026-1-2",
    "2026-10-02T12:00",
    "2026-10-02T12:00Z",
    "2026-10-02T12:00+09:00",
    "2026-10-02T12:00:30",
    " 2026-10-02",
    "2026-10-02 ",
    "",
    null,
    undefined,
    2026,
    new Blob(["date"]),
  ])("rejects empty, non-text, impossible, or time-bearing values", (value) => {
    expect(validateGameDateInput(value, NOW).ok).toBe(false);
  });

  it("formats only the Korea date across midnight and year boundaries", () => {
    expect(formatKoreaDateInput(new Date("2025-12-31T14:59:59.000Z"))).toBe(
      "2025-12-31",
    );
    expect(formatKoreaDateInput(new Date("2025-12-31T15:00:00.000Z"))).toBe(
      "2026-01-01",
    );
    expect(formatKoreaDateInput(new Date("2025-12-31T15:20:59.000Z"))).toBe(
      "2026-01-01",
    );
  });
});

describe("game date source labels", () => {
  it("distinguishes manual dates from both estimates", () => {
    expect(playedAtSourceLabel("manual")).toBe("직접 수정");
    expect(playedAtSourceLabel("file_mtime")).toBe("파일 날짜 추정");
    expect(playedAtSourceLabel("upload")).toBe("업로드 날짜 추정");
    expect(playedAtSourceLabel("unexpected")).toBe("출처 불명");
  });
});
