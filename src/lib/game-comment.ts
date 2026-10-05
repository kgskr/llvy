export const MAX_GAME_COMMENT_LENGTH = 30;

/** Code-point counting matches PostgreSQL char_length; preserve all spaces. */
export function validateGameComment(
  value: unknown,
): { ok: true; comment: string | null } | { ok: false; error: string } {
  if (typeof value !== "string")
    return { ok: false, error: "게임 코멘트를 입력하세요." };
  if ([...value].length > MAX_GAME_COMMENT_LENGTH)
    return { ok: false, error: "코멘트는 공백 포함 30자 이내로 입력하세요." };
  // Lone UTF-16 surrogates cannot round-trip to PostgreSQL's UTF-8 text.
  if (!value.isWellFormed() || value.includes("\0"))
    return { ok: false, error: "코멘트에 사용할 수 없는 문자가 있습니다." };
  return { ok: true, comment: value === "" ? null : value };
}
