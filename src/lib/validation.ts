export const MEMBER_NAME_MAX_LENGTH = 80;
export const MIN_BIRTH_YEAR = 1900;

export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

type MemberInput =
  | { ok: true; name: string; birthYear: number | null }
  | { ok: false; error: string };

export function validateMemberInput(
  nameValue: unknown,
  birthYearValue: unknown,
  currentYear = new Date().getFullYear(),
): MemberInput {
  const name = typeof nameValue === "string" ? nameValue.trim() : "";
  if (!name || name.length > MEMBER_NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `이름은 1~${MEMBER_NAME_MAX_LENGTH}자로 입력하세요.`,
    };
  }

  const raw = typeof birthYearValue === "string" ? birthYearValue.trim() : "";
  if (birthYearValue != null && typeof birthYearValue !== "string") {
    return { ok: false, error: "생년을 숫자로 입력하세요." };
  }
  if (!raw) return { ok: true, name, birthYear: null };

  const birthYear = Number(raw);
  if (
    !/^\d{4}$/.test(raw) ||
    !Number.isInteger(birthYear) ||
    birthYear < MIN_BIRTH_YEAR ||
    birthYear > currentYear
  ) {
    return {
      ok: false,
      error: `생년은 ${MIN_BIRTH_YEAR}~${currentYear} 사이의 연도로 입력하세요.`,
    };
  }
  return { ok: true, name, birthYear };
}

export function parsePageNumber(value: string | string[] | undefined): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}
