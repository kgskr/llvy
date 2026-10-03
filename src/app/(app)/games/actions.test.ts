import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertSession: vi.fn(),
  setGameExcluded: vi.fn(),
  setGamePlayedAt: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/games", () => ({
  setGameExcluded: mocks.setGameExcluded,
  setGamePlayedAt: mocks.setGamePlayedAt,
}));
vi.mock("@/lib/session", () => ({
  assertSession: mocks.assertSession,
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

import { UnauthorizedError } from "@/lib/session";
import {
  restoreGameDateAction,
  setGameExcludedAction,
  updateGameDateAction,
} from "./actions";

const GAME_ID = "0279e981-365c-4352-a993-aa130402c9d7";
const ACTIONS = [
  setGameExcludedAction,
  updateGameDateAction,
  restoreGameDateAction,
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
  mocks.assertSession.mockResolvedValue(undefined);
  mocks.setGameExcluded.mockResolvedValue(true);
  mocks.setGamePlayedAt.mockResolvedValue(true);
});

afterEach(() => vi.useRealTimers());

function expectHistoryRevalidated() {
  expect(mocks.revalidatePath.mock.calls).toEqual([
    ["/games"],
    ["/games/[id]", "page"],
    ["/members"],
    ["/members/[id]", "page"],
  ]);
}

describe("authenticated game mutations", () => {
  it("blocks every unauthenticated action before any database write", async () => {
    mocks.assertSession.mockRejectedValue(new UnauthorizedError());
    const data = form({
      gameId: GAME_ID,
      excluded: "true",
      playedAt: "2026-10-02T21:00",
    });
    for (const action of ACTIONS) {
      const result = await action(null, data);
      expect(result?.status).toBe("error");
      expect(result?.message).toContain("로그인");
    }
    expect(mocks.setGameExcluded).not.toHaveBeenCalled();
    expect(mocks.setGamePlayedAt).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "not-a-uuid"])(
    "rejects missing or malformed game IDs for all mutations",
    async (gameId) => {
      const data = form({ excluded: "true", playedAt: "2026-10-02T21:00" });
      if (gameId !== undefined) data.set("gameId", gameId);
      for (const action of ACTIONS)
        expect((await action(null, data))?.status).toBe("error");
      expect(mocks.setGameExcluded).not.toHaveBeenCalled();
      expect(mocks.setGamePlayedAt).not.toHaveBeenCalled();
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

  it("saves the submitted Korea time as UTC and updates game and member history", async () => {
    expect(
      (
        await updateGameDateAction(
          null,
          form({ gameId: GAME_ID, playedAt: "2026-10-02T21:35" }),
        )
      )?.status,
    ).toBe("success");
    expect(mocks.setGamePlayedAt).toHaveBeenCalledWith(
      GAME_ID,
      new Date("2026-10-02T12:35:00.000Z"),
    );
    expectHistoryRevalidated();
  });

  it.each(["", "2025-02-29T12:00", "2008-12-31T23:59", "2026-10-04T12:01"])(
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

  it("restores by clearing only the override, ignoring any caller-provided original timestamp", async () => {
    expect(
      (
        await restoreGameDateAction(
          null,
          form({ gameId: GAME_ID, playedAt: "2001-01-01T00:00" }),
        )
      )?.status,
    ).toBe("success");
    expect(mocks.setGamePlayedAt).toHaveBeenCalledWith(GAME_ID, null);
    expectHistoryRevalidated();
  });

  it("reports missing games for every mutation without claiming success", async () => {
    mocks.setGameExcluded.mockResolvedValue(false);
    mocks.setGamePlayedAt.mockResolvedValue(false);
    const data = form({
      gameId: GAME_ID,
      excluded: "true",
      playedAt: "2026-10-02T21:35",
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
        form({ gameId: GAME_ID, playedAt: "2026-10-02T21:35" }),
      );
      expect(result?.status).toBe("error");
      expect(result?.message).not.toContain("database-private-detail");
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
