import { describe, expect, it } from "vitest";

import {
  formatKoreaDateInput,
  playedAtSourceLabel,
  validateGameDateInput,
} from "./game-date";

const NOW = new Date("2026-10-03T03:00:00.000Z");

describe("Korea-local game date input", () => {
  it("converts a Korea-local minute to the correct UTC instant", () => {
    const result = validateGameDateInput("2026-10-02T21:35", NOW);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.date.toISOString()).toBe("2026-10-02T12:35:00.000Z");
  });

  it("allows the first minute of 2009 in Korea", () => {
    const result = validateGameDateInput("2009-01-01T00:00", NOW);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.date.toISOString()).toBe("2008-12-31T15:00:00.000Z");
  });

  it("accepts leap days only in leap years", () => {
    expect(validateGameDateInput("2024-02-29T12:00", NOW).ok).toBe(true);
    expect(validateGameDateInput("2025-02-29T12:00", NOW).ok).toBe(false);
  });

  it("allows exactly 24 hours ahead, but no later", () => {
    expect(validateGameDateInput("2026-10-04T12:00", NOW).ok).toBe(true);
    expect(validateGameDateInput("2026-10-04T12:01", NOW).ok).toBe(false);
  });

  it.each([
    "2008-12-31T23:59",
    "2026-00-01T12:00",
    "2026-13-01T12:00",
    "2026-04-31T12:00",
    "2026-02-00T12:00",
    "2026-10-02T24:00",
    "2026-10-02T12:60",
    "2026-1-2T1:00",
    "2026-10-02",
    "2026-10-02T12:00Z",
    "2026-10-02T12:00+09:00",
    "2026-10-02T12:00:30",
    " 2026-10-02T12:00",
    "2026-10-02T12:00 ",
    "",
    null,
    undefined,
    2026,
    new Blob(["date"]),
  ])("rejects empty, non-text, impossible, or non-local values", (value) => {
    expect(validateGameDateInput(value, NOW).ok).toBe(false);
  });

  it("formats input in Korea time across a UTC date boundary", () => {
    expect(formatKoreaDateInput(new Date("2025-12-31T15:20:59.000Z"))).toBe(
      "2026-01-01T00:20",
    );
  });
});

describe("game date source labels", () => {
  it("distinguishes manual dates from both estimates", () => {
    expect(playedAtSourceLabel("manual")).toBe("직접 수정");
    expect(playedAtSourceLabel("file_mtime")).toBe("파일 시각 추정");
    expect(playedAtSourceLabel("upload")).toBe("업로드 시각 추정");
    expect(playedAtSourceLabel("unexpected")).toBe("출처 불명");
  });
});
