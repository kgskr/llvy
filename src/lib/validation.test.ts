import { describe, expect, it } from "vitest";
import { isUuid, parsePageNumber, validateMemberInput } from "./validation";

describe("member input validation", () => {
  it("trims names and accepts an optional birth year", () => {
    expect(validateMemberInput("  길수  ", "1995", 2026)).toEqual({
      ok: true,
      name: "길수",
      birthYear: 1995,
    });
    expect(validateMemberInput("길수", "", 2026)).toEqual({
      ok: true,
      name: "길수",
      birthYear: null,
    });
    expect(validateMemberInput("길수", null, 2026)).toEqual({
      ok: true,
      name: "길수",
      birthYear: null,
    });
  });

  it.each(["1995.9", "1995junk", "-1", "1899", "2027", "1e3", "0x780", "NaN"])(
    "rejects invalid year %s instead of truncating it",
    (year) => {
      expect(validateMemberInput("길수", year, 2026).ok).toBe(false);
    },
  );

  it.each(["1900", "2026"])("accepts boundary year %s", (year) => {
    expect(validateMemberInput("길수", year, 2026).ok).toBe(true);
  });

  it.each(["", "   ", "가".repeat(81), null, new Blob(["name"])])(
    "rejects empty, long, or non-text names",
    (name) => {
      expect(validateMemberInput(name, "1995", 2026).ok).toBe(false);
    },
  );

  it("rejects non-text form values for birth year", () => {
    expect(validateMemberInput("길수", new Blob(["1995"]), 2026).ok).toBe(
      false,
    );
  });
});

describe("UUID input", () => {
  it("accepts generated UUIDs", () => {
    expect(isUuid("59a8c568-52e8-4858-9f20-d2ae9877d7a4")).toBe(true);
  });
  it.each([
    undefined,
    null,
    "",
    "not-a-uuid",
    "59a8c568-52e8-4858-9f20-d2ae9877d7a4x",
  ])("rejects invalid identifiers", (value) => {
    expect(isUuid(value)).toBe(false);
  });
});

describe("page parameters", () => {
  it("accepts positive integers", () => {
    expect(parsePageNumber("5")).toBe(5);
  });
  it.each([
    undefined,
    ["1", "2"],
    "0",
    "-1",
    "1.5",
    "garbage",
    "Infinity",
    "9007199254740992",
  ])("uses the first page for invalid input", (value) => {
    expect(parsePageNumber(value)).toBe(1);
  });
});
