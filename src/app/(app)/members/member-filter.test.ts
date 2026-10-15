import { describe, expect, it } from "vitest";

import { filterMembers } from "./member-filter";

const members = [
  {
    id: "first",
    name: "김가나다",
    birthYear: 1991,
    accounts: [
      { gameName: "MainPlayer", tagLine: "KR1" },
      { gameName: "SecondPlayer", tagLine: "ALT" },
    ],
  },
  { id: "second", name: "가나다", accounts: [] },
  {
    id: "third",
    name: "Alice",
    accounts: [{ gameName: "Café_100%", tagLine: "EUW" }],
  },
  { id: "fourth", name: "가나다", accounts: [] },
];

describe("member list filtering", () => {
  it("matches inner name fragments, keeps order and retains same-name members", () => {
    expect(filterMembers(members, "나다").map((member) => member.id)).toEqual([
      "first",
      "second",
      "fourth",
    ]);
  });

  it.each(["second", "ALT", "player#alt", "secondplayer#ALT"])(
    "matches any linked account including nickname and tag fragments: %s",
    (query) => {
      expect(filterMembers(members, query)).toEqual([members[0]]);
    },
  );

  it("shows a member once with every account when several accounts match", () => {
    const filtered = filterMembers(members, "player");
    expect(filtered).toEqual([members[0]]);
    expect(filtered[0].accounts).toHaveLength(2);
  });

  it.each([
    ["  aLiCe  ", "third"],
    ["Cafe\u0301", "third"],
    ["김", "first"],
    ["%", "third"],
    ["_", "third"],
    ["#euw", "third"],
  ])("normalizes text and treats punctuation literally: %s", (query, id) => {
    expect(filterMembers(members, query).map((member) => member.id)).toEqual([
      id,
    ]);
  });

  it("restores all members after a search without mutating source data", () => {
    const original = structuredClone(members);
    filterMembers(members, "second");
    expect(filterMembers(members, "")).toEqual(original);
    expect(filterMembers(members, " \t ")).toEqual(original);
    expect(members).toEqual(original);
  });

  it("returns no matches for unknown text and does not search birth years", () => {
    expect(filterMembers(members, "없는이름")).toEqual([]);
    expect(filterMembers(members, "1991")).toEqual([]);
    expect(filterMembers([], "player")).toEqual([]);
  });
});
