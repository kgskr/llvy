import { describe, expect, it } from "vitest";
import { readItemSlots } from "./item-slots";

describe("final item slots", () => {
  it("retains all seven positions, duplicates and the empty/unknown distinction", () => {
    expect(
      readItemSlots({
        ITEM0: " 3158 ",
        ITEM1: 1038,
        ITEM2: 1038,
        ITEM3: "0",
        ITEM4: "1e3",
        ITEM5: -1,
        ITEM6: "3340",
      }),
    ).toEqual([3158, 1038, 1038, 0, null, null, 3340]);
  });
  it.each([
    null,
    [],
    "invalid",
    {},
    {
      ITEM0: true,
      ITEM1: {},
      ITEM2: 1.5,
      ITEM3: Infinity,
      ITEM4: "",
      ITEM5: 2147483648,
      ITEM6: "../3340",
    },
  ])("does not turn malformed or absent values into empty slots: %j", (raw) => {
    expect(readItemSlots(raw)).toEqual(Array(7).fill(null));
  });
});
