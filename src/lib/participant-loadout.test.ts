import { expect, it } from "vitest";
import { readParticipantLoadout } from "./participant-loadout";

it("reads stored scalar levels and inventory without carrying private fields", () => {
  expect(
    readParticipantLoadout({
      LEVEL: "17",
      ITEM0: "3158",
      ITEM6: 3340,
      PUUID: "private",
    }),
  ).toEqual({
    level: 17,
    items: [3158, null, null, null, null, null, 3340],
  });
});

it.each([
  null,
  undefined,
  [],
  {},
  { LEVEL: true },
  { LEVEL: "" },
  { LEVEL: "1.5" },
  { LEVEL: -1 },
  { LEVEL: 0 },
  { LEVEL: 100 },
  { LEVEL: {} },
])("keeps invalid or missing levels unknown: %j", (raw) => {
  expect(readParticipantLoadout(raw).level).toBeNull();
});
