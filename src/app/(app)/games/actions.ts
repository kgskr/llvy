"use server";

import { revalidatePath } from "next/cache";

import { validateGameDateInput } from "@/lib/game-date";
import { setGameExcluded, setGamePlayedAt } from "@/lib/games";
import { assertSession, UnauthorizedError } from "@/lib/session";
import { isUuid } from "@/lib/validation";

type GameActionResult = { status: "success" | "error"; message: string };
export type GameActionState = GameActionResult | null;

async function runGameAction(
  action: () => Promise<GameActionResult>,
): Promise<GameActionResult> {
  try {
    await assertSession();
    return await action();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return {
        status: "error",
        message: "로그인이 만료되었습니다. 다시 로그인하세요.",
      };
    }
    console.error("Game update failed", error);
    return {
      status: "error",
      message: "변경하지 못했습니다. 새로고침한 뒤 다시 시도하세요.",
    };
  }
}

function revalidateGames() {
  revalidatePath("/games");
  revalidatePath("/games/[id]", "page");
  revalidatePath("/members");
  revalidatePath("/members/[id]", "page");
}

const INVALID_GAME: GameActionResult = {
  status: "error",
  message: "변경할 경기를 확인하세요.",
};
const MISSING_GAME: GameActionResult = {
  status: "error",
  message: "경기를 찾지 못했습니다. 목록을 새로고침하세요.",
};

export async function setGameExcludedAction(
  _previousState: GameActionState,
  formData: FormData,
): Promise<GameActionState> {
  return runGameAction(async () => {
    const gameId = formData.get("gameId");
    if (!isUuid(gameId)) return INVALID_GAME;
    const excluded = formData.get("excluded");
    if (excluded !== "true" && excluded !== "false") {
      return {
        status: "error",
        message: "경기를 제외할지 복구할지 선택하세요.",
      };
    }
    if (!(await setGameExcluded(gameId, excluded === "true")))
      return MISSING_GAME;
    revalidateGames();
    return {
      status: "success",
      message:
        excluded === "true"
          ? "경기를 제외했습니다. 제외된 경기에서 언제든 복구할 수 있습니다."
          : "경기를 복구했습니다.",
    };
  });
}

export async function updateGameDateAction(
  _previousState: GameActionState,
  formData: FormData,
): Promise<GameActionState> {
  return runGameAction(async () => {
    const gameId = formData.get("gameId");
    if (!isUuid(gameId)) return INVALID_GAME;
    const input = validateGameDateInput(formData.get("playedAt"));
    if (!input.ok) return { status: "error", message: input.error };
    if (!(await setGamePlayedAt(gameId, input.date))) return MISSING_GAME;
    revalidateGames();
    return { status: "success", message: "경기 날짜를 수정했습니다." };
  });
}

export async function restoreGameDateAction(
  _previousState: GameActionState,
  formData: FormData,
): Promise<GameActionState> {
  return runGameAction(async () => {
    const gameId = formData.get("gameId");
    if (!isUuid(gameId)) return INVALID_GAME;
    if (!(await setGamePlayedAt(gameId, null))) return MISSING_GAME;
    revalidateGames();
    return { status: "success", message: "원본 경기 날짜로 되돌렸습니다." };
  });
}
