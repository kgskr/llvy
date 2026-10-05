import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  assertAdmin: vi.fn(),
  setGameExcluded: vi.fn(),
  setGamePlayedAt: vi.fn(),
  setGameComment: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/game-mutations", () => ({
  setGameExcluded: mocks.setGameExcluded,
  setGamePlayedAt: mocks.setGamePlayedAt,
  setGameComment: mocks.setGameComment,
}));
vi.mock("@/lib/session", () => ({
  assertAdmin: mocks.assertAdmin,
  UnauthorizedError: class UnauthorizedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

import { ForbiddenError, UnauthorizedError } from "@/lib/session";
import {
  restoreGameDateAction,
  setGameExcludedAction,
  updateGameDateAction,
  updateGameCommentAction,
} from "./actions";
import { GameCommentForm, GameDateForm } from "./forms";

const GAME_ID = "0279e981-365c-4352-a993-aa130402c9d7";
const ACTIONS = [
  setGameExcludedAction,
  updateGameDateAction,
  restoreGameDateAction,
  updateGameCommentAction,
];

function form(values: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-03T03:00:00.000Z"));
  mocks.assertAdmin.mockResolvedValue(undefined);
  mocks.setGameExcluded.mockResolvedValue(true);
  mocks.setGamePlayedAt.mockResolvedValue(true);
  mocks.setGameComment.mockResolvedValue(true);
});

afterEach(() => vi.useRealTimers());

function expectHistoryRevalidated() {
  expect(mocks.revalidatePath.mock.calls).toEqual([
    ["/games"],
    ["/games/[id]", "page"],
    ["/members"],
    ["/members/[id]", "page"],
    ["/admin"],
  ]);
}

describe("authenticated game mutations", () => {
  it("blocks every unauthenticated action before any database write", async () => {
    mocks.assertAdmin.mockRejectedValue(new UnauthorizedError());
    const data = form({
      gameId: GAME_ID,
      excluded: "true",
      playedAt: "2026-10-02",
      comment: "코멘트",
    });
    for (const action of ACTIONS) {
      const result = await action(null, data);
      expect(result?.status).toBe("error");
      expect(result?.message).toContain("로그인");
    }
    expect(mocks.setGameExcluded).not.toHaveBeenCalled();
    expect(mocks.setGamePlayedAt).not.toHaveBeenCalled();
    expect(mocks.setGameComment).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "not-a-uuid"])(
    "rejects missing or malformed game IDs for all mutations",
    async (gameId) => {
      const data = form({
        excluded: "true",
        playedAt: "2026-10-02",
        comment: "코멘트",
      });
      if (gameId !== undefined) data.set("gameId", gameId);
      for (const action of ACTIONS)
        expect((await action(null, data))?.status).toBe("error");
      expect(mocks.setGameExcluded).not.toHaveBeenCalled();
      expect(mocks.setGamePlayedAt).not.toHaveBeenCalled();
      expect(mocks.setGameComment).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    "sets exclusion explicitly to %s and refreshes all affected views",
    async (excluded) => {
      expect(
        (
          await setGameExcludedAction(
            null,
            form({ gameId: GAME_ID, excluded: String(excluded) }),
          )
        )?.status,
      ).toBe("success");
      expect(mocks.setGameExcluded).toHaveBeenCalledWith(GAME_ID, excluded);
      expectHistoryRevalidated();
    },
  );

  it.each(["", "yes", "1", "TRUE"])(
    "does not coerce an invalid exclusion value",
    async (excluded) => {
      expect(
        (await setGameExcludedAction(null, form({ gameId: GAME_ID, excluded })))
          ?.status,
      ).toBe("error");
      expect(mocks.setGameExcluded).not.toHaveBeenCalled();
    },
  );

  it("saves the submitted calendar date unchanged and refreshes game/history", async () => {
    expect(
      (
        await updateGameDateAction(
          null,
          form({ gameId: GAME_ID, playedAt: "2026-10-02" }),
        )
      )?.status,
    ).toBe("success");
    expect(mocks.setGamePlayedAt).toHaveBeenCalledWith(GAME_ID, "2026-10-02");
    expectHistoryRevalidated();
  });

  it.each(["", "2025-02-29", "2008-12-31", "2026-10-05", "2026-10-02T21:35"])(
    "leaves dates unchanged on invalid input",
    async (playedAt) => {
      expect(
        (await updateGameDateAction(null, form({ gameId: GAME_ID, playedAt })))
          ?.status,
      ).toBe("error");
      expect(mocks.setGamePlayedAt).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("restores by clearing only the override, ignoring caller-provided original dates", async () => {
    expect(
      (
        await restoreGameDateAction(
          null,
          form({ gameId: GAME_ID, playedAt: "2001-01-01" }),
        )
      )?.status,
    ).toBe("success");
    expect(mocks.setGamePlayedAt).toHaveBeenCalledWith(GAME_ID, null);
    expectHistoryRevalidated();
  });

  it("reports missing games for every mutation without claiming success", async () => {
    mocks.setGameExcluded.mockResolvedValue(false);
    mocks.setGamePlayedAt.mockResolvedValue(false);
    mocks.setGameComment.mockResolvedValue(false);
    const data = form({
      gameId: GAME_ID,
      excluded: "true",
      playedAt: "2026-10-02",
      comment: "코멘트",
    });
    for (const action of ACTIONS) {
      const result = await action(null, data);
      expect(result?.status).toBe("error");
      expect(result?.message).toContain("찾지 못했습니다");
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns retry feedback on database errors without leaking raw details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.setGamePlayedAt.mockRejectedValue(
      new Error("database-private-detail"),
    );
    try {
      const result = await updateGameDateAction(
        null,
        form({ gameId: GAME_ID, playedAt: "2026-10-02" }),
      );
      expect(result?.status).toBe("error");
      expect(result?.message).not.toContain("database-private-detail");
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("blocks viewer direct comment writes even with a valid game ID", async () => {
    mocks.assertAdmin.mockRejectedValue(new ForbiddenError());
    expect(
      await updateGameCommentAction(
        null,
        form({ gameId: GAME_ID, comment: "비공개 변경" }),
      ),
    ).toEqual({ status: "error", message: "관리자 권한이 필요합니다." });
    expect(mocks.setGameComment).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([" 한 줄  ", "첫 줄\n둘째 줄", "😀".repeat(30), " ".repeat(30)])(
    "preserves valid comment whitespace and Unicode input",
    async (comment) => {
      expect(
        (
          await updateGameCommentAction(
            null,
            form({ gameId: GAME_ID, comment }),
          )
        )?.status,
      ).toBe("success");
      expect(mocks.setGameComment).toHaveBeenCalledWith(GAME_ID, comment);
      expectHistoryRevalidated();
    },
  );

  it("clears the shared comment on empty input", async () => {
    expect(
      (
        await updateGameCommentAction(
          null,
          form({ gameId: GAME_ID, comment: "" }),
        )
      )?.message,
    ).toContain("지웠습니다");
    expect(mocks.setGameComment).toHaveBeenCalledWith(GAME_ID, "");
    expectHistoryRevalidated();
  });

  it.each(["a".repeat(31), "😀".repeat(31)])(
    "rejects overlong comments before writes",
    async (comment) => {
      expect(
        (
          await updateGameCommentAction(
            null,
            form({ gameId: GAME_ID, comment }),
          )
        )?.status,
      ).toBe("error");
      expect(mocks.setGameComment).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("rejects a non-text or missing comment instead of silently clearing it", async () => {
    const fileForm = form({ gameId: GAME_ID });
    fileForm.set("comment", new Blob(["text"]));
    for (const data of [form({ gameId: GAME_ID }), fileForm]) {
      expect((await updateGameCommentAction(null, data))?.status).toBe("error");
    }
    expect(mocks.setGameComment).not.toHaveBeenCalled();
  });
});

describe("calendar and comment form display", () => {
  it("uses date-only input and preserves original-date restoration", () => {
    const html = renderToStaticMarkup(
      createElement(GameDateForm, {
        gameId: GAME_ID,
        currentValue: "2026-10-02",
        originalValue: "2026-10-01",
        hasOverride: true,
      }),
    );
    expect(html).toContain('type="date"');
    expect(html).toContain('value="2026-10-02"');
    expect(html).toContain('min="2009-01-01"');
    expect(html).toContain("원본 날짜로 되돌리기");
    expect(html).not.toContain("datetime-local");
    expect(html).not.toContain("UTC+09:00");
  });

  it("counts emoji as one character without a UTF-16 maxlength restriction", () => {
    const html = renderToStaticMarkup(
      createElement(GameCommentForm, {
        gameId: GAME_ID,
        currentValue: "😀".repeat(30),
      }),
    );
    expect(html).toContain("공백 포함 30 / 30자");
    expect(html).not.toContain("maxLength");
    expect(html).not.toContain("maxlength");
    expect(html).not.toContain('aria-invalid="true"');
    expect(html).toContain("코멘트 지우기");
  });
});
