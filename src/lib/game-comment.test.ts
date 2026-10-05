import { describe, expect, it } from "vitest";

import { validateGameComment } from "@/lib/game-comment";

describe("game comment input", () => {
  it.each([
    "가".repeat(30),
    "😀".repeat(30),
    ` ${"x".repeat(28)} `,
    " ".repeat(30),
  ])("preserves exactly thirty code points including whitespace: %s", (value) =>
    expect(validateGameComment(value)).toEqual({ ok: true, comment: value }),
  );

  it.each(["가".repeat(31), "😀".repeat(31), ` ${"x".repeat(29)} `])(
    "rejects thirty-one code points: %s",
    (value) => expect(validateGameComment(value).ok).toBe(false),
  );

  it("only clears an empty string, without trimming spaces or normalizing text", () => {
    expect(validateGameComment("")).toEqual({ ok: true, comment: null });
    expect(validateGameComment(" 안녕\n ")).toEqual({
      ok: true,
      comment: " 안녕\n ",
    });
    expect(validateGameComment("e\u0301")).toEqual({
      ok: true,
      comment: "e\u0301",
    });
  });

  it.each([null, undefined, 123, new FormData(), "a\0b", "\ud800", "\udc00"])(
    "rejects non-text or invalid UTF-8 input: %s",
    (value) => expect(validateGameComment(value).ok).toBe(false),
  );
});
