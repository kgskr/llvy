import { isUuid } from "@/lib/validation";
import { normalizeSearchText } from "@/lib/search-normalization";

export const AUTOCOMPLETE_LIMIT = 10;
export type RiotPreview = { gameName: string; tagLine: string };
export type NicknameSuggestion = RiotPreview & { id: string };
export type MemberSuggestion = {
  kind: "member";
  id: string;
  name: string;
  accounts: RiotPreview[];
};
export type SearchSuggestion =
  MemberSuggestion | (NicknameSuggestion & { kind: "riot-account" });
export type SearchInput = { mode: "unified" | "nickname"; input: string };
export type SearchParameters = {
  q?: string | string[];
  nickname?: string | string[];
  page?: string | string[];
};

/** null means conflicting/repeated parameters, not an empty search string. */
export function parseSearchInput(params: SearchParameters): SearchInput | null {
  if (
    Array.isArray(params.q) ||
    Array.isArray(params.nickname) ||
    (params.q !== undefined && params.nickname !== undefined)
  )
    return null;
  return params.nickname !== undefined
    ? { mode: "nickname", input: params.nickname }
    : { mode: "unified", input: params.q ?? "" };
}

export function normalizeSearchPart(value: string): string {
  return normalizeSearchText(value);
}

export function normalizeSearchInput(input: string): string | null {
  // With /u, this range matches unpaired surrogates, not valid astral characters.
  if (/[\p{Cc}\uD800-\uDFFF]/u.test(input)) return null;
  const value = normalizeSearchPart(input);
  return value && [...value].length <= 100 ? value : null;
}

export function normalizeNicknamePrefix(input: string): string | null {
  const value = normalizeSearchInput(input);
  if (!value) return null;
  const parts = value.split("#");
  if (parts.length > 2 || !parts[0].trim()) return null;
  return parts.map((part) => part.trim()).join("#");
}

export function projectNicknameSuggestion(
  value: unknown,
): NicknameSuggestion | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    !isUuid(v.id) ||
    typeof v.gameName !== "string" ||
    typeof v.tagLine !== "string"
  )
    return null;
  return { id: v.id, gameName: v.gameName, tagLine: v.tagLine };
}

export function projectSearchSuggestion(
  value: unknown,
): SearchSuggestion | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.kind === "riot-account") {
    const account = projectNicknameSuggestion(v);
    return account ? { kind: "riot-account", ...account } : null;
  }
  if (
    v.kind !== "member" ||
    !isUuid(v.id) ||
    typeof v.name !== "string" ||
    !Array.isArray(v.accounts) ||
    v.accounts.length > 2
  )
    return null;
  const accounts: RiotPreview[] = [];
  for (const account of v.accounts) {
    if (
      !account ||
      typeof account.gameName !== "string" ||
      typeof account.tagLine !== "string"
    )
      return null;
    accounts.push({ gameName: account.gameName, tagLine: account.tagLine });
  }
  return { kind: "member", id: v.id, name: v.name, accounts };
}

const encoder = new TextEncoder();
/** Matches Valkey's UTF-8 BYLEX ordering, including astral characters. */
export function compareSearchText(a: string, b: string): number {
  const left = encoder.encode(a),
    right = encoder.encode(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}

export function nicknameIndexKey(account: NicknameSuggestion): string {
  return `${normalizeSearchPart(account.gameName)}#${normalizeSearchPart(account.tagLine)}\u0000${account.id}`;
}

export function memberIndexKey(member: MemberSuggestion): string {
  return `${normalizeSearchPart(member.name)}\u0000${member.id}`;
}

/** Deduplicate and reserve five slots per type before lending unused capacity. */
export function mergeSearchSuggestions(
  entries: SearchSuggestion[],
): SearchSuggestion[] {
  const unique = [
    ...new Map(
      entries.map((entry) => [`${entry.kind}:${entry.id}`, entry]),
    ).values(),
  ];
  const members = unique
    .filter((entry): entry is MemberSuggestion => entry.kind === "member")
    .sort((a, b) => compareSearchText(memberIndexKey(a), memberIndexKey(b)));
  const accounts = unique
    .filter(
      (entry): entry is NicknameSuggestion & { kind: "riot-account" } =>
        entry.kind === "riot-account",
    )
    .sort((a, b) =>
      compareSearchText(nicknameIndexKey(a), nicknameIndexKey(b)),
    );
  const memberCount = Math.min(
    members.length,
    5 + Math.max(0, 5 - accounts.length),
  );
  return [
    ...members.slice(0, memberCount),
    ...accounts.slice(0, AUTOCOMPLETE_LIMIT - memberCount),
  ];
}

export function searchPageHref(search: SearchInput, page: number): string {
  const params = new URLSearchParams({
    [search.mode === "unified" ? "q" : "nickname"]: search.input,
    page: String(page),
  });
  return `/search?${params}`;
}
