import { describe, expect, it } from "vitest";
import {
  compareSearchText,
  mergeSearchSuggestions,
  normalizeSearchInput,
  normalizeNicknamePrefix,
  parseSearchInput,
  projectSearchSuggestion,
  searchPageHref,
  type MemberSuggestion,
} from "./search-contract";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const member = (n: number): MemberSuggestion => ({
  kind: "member",
  id: id(n),
  name: `김${n}`,
  accounts: [],
});
const account = (n: number) => ({
  kind: "riot-account" as const,
  id: id(n),
  gameName: `김${n}`,
  tagLine: "KR1",
});

describe("search input contract", () => {
  it("normalizes NFC, surrounding spaces and case while treating name punctuation literally", () => {
    expect(normalizeSearchInput("  CAFE\u0301  ")).toBe("café");
    for (const value of ["김#이#박", "%_", "<script>", "😀", "김 길수"])
      expect(normalizeSearchInput(value)).toBe(value);
    expect(normalizeSearchInput("😀".repeat(100))).toBe("😀".repeat(100));
    expect(normalizeNicknamePrefix(" 가 # KR ")).toBe("가#kr");
    expect(normalizeNicknamePrefix("가#")).toBe("가#");
    expect(normalizeNicknamePrefix("가#나#다")).toBeNull();
  });
  it.each([
    "",
    "   ",
    "a".repeat(101),
    "😀".repeat(101),
    "a\0b",
    "a\n",
    "\tb",
    "\u0085",
    "\ud800",
    "a\udfff",
  ])("rejects invalid input %j", (input) => {
    expect(normalizeSearchInput(input)).toBeNull();
    expect(normalizeNicknamePrefix(input)).toBeNull();
  });
  it("distinguishes legacy and unified modes and rejects repeated or mixed parameters", () => {
    expect(parseSearchInput({ q: "김" })).toEqual({
      mode: "unified",
      input: "김",
    });
    expect(parseSearchInput({ nickname: "김" })).toEqual({
      mode: "nickname",
      input: "김",
    });
    expect(parseSearchInput({})).toEqual({ mode: "unified", input: "" });
    for (const input of [
      { q: ["a"] },
      { nickname: ["a", "b"] },
      { q: "", nickname: "" },
    ])
      expect(parseSearchInput(input)).toBeNull();
    expect(searchPageHref({ mode: "unified", input: "김# &?" }, 2)).toBe(
      "/search?q=%EA%B9%80%23+%26%3F&page=2",
    );
  });
});

describe("candidate allocation and projection", () => {
  it.each([
    [10, 10, 5, 5],
    [2, 10, 2, 8],
    [10, 2, 8, 2],
    [0, 12, 0, 10],
    [12, 0, 10, 0],
  ])("allocates %i members and %i accounts", (m, a, expectedM, expectedA) => {
    const candidates = [
      ...Array.from({ length: m }, (_, i) => member(i)),
      ...Array.from({ length: a }, (_, i) => account(i)),
    ];
    const result = mergeSearchSuggestions(
      [...candidates, ...candidates].reverse(),
    );
    expect(result.filter((s) => s.kind === "member")).toHaveLength(expectedM);
    expect(result.filter((s) => s.kind === "riot-account")).toHaveLength(
      expectedA,
    );
    expect(result).toEqual(mergeSearchSuggestions(candidates));
    expect(result.slice(0, expectedM).every((s) => s.kind === "member")).toBe(
      true,
    );
  });
  it("sorts by UTF-8 bytes and then UUID, not locale or UTF-16 order", () => {
    expect(compareSearchText("\ue000", "😀")).toBeLessThan(0);
    const result = mergeSearchSuggestions([
      { ...member(2), name: "동명" },
      { ...member(1), name: "동명" },
    ]);
    expect(result.map((s) => s.id)).toEqual([id(1), id(2)]);
  });
  it("strips private fields from both candidates and nested account previews", () => {
    expect(
      projectSearchSuggestion({
        ...member(1),
        birthYear: 1991,
        accounts: [{ gameName: "닉", tagLine: "KR1", puuid: "private" }],
      }),
    ).toEqual({ ...member(1), accounts: [{ gameName: "닉", tagLine: "KR1" }] });
    expect(
      projectSearchSuggestion({ ...account(1), memberName: "private" }),
    ).toEqual(account(1));
  });
});
