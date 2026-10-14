import "server-only";

import { and, asc, count, eq, isNotNull, sql } from "drizzle-orm";
import { union } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { gameParticipants, games, members, riotAccounts } from "@/db/schema";
import { cachedQuery } from "@/lib/query-cache";
import {
  prepareCache,
  cacheDependencies,
  type CacheContext,
} from "@/lib/cache-context";
import { assertSession } from "@/lib/session";
import {
  normalizeNicknamePart,
  normalizeNicknamePrefix,
  queryNicknameAutocomplete,
} from "@/lib/nickname-autocomplete";
import { createAutocompleteIndex } from "@/lib/autocomplete-index";
import {
  compareSearchText,
  memberIndexKey,
  nicknameIndexKey,
  mergeSearchSuggestions,
  normalizeSearchInput,
  projectSearchSuggestion,
  type MemberSuggestion,
  type SearchInput,
} from "@/lib/search-contract";
export type { NicknameSuggestion } from "@/lib/nickname-autocomplete";

export type NicknameSearch = { gameName: string; tagLine: string | null };

export function normalizeNicknameSearch(input: string): NicknameSearch | null {
  const value = normalizeSearchInput(input);
  if (!value) return null;
  const parts = value.split("#");
  const gameName = parts[0].trim();
  const tagLine = parts.length === 2 ? parts[1].trim() : null;
  if (!gameName || parts.length > 2 || tagLine === "") return null;
  return { gameName, tagLine };
}

const activeHistory = sql`exists (select 1 from ${gameParticipants}
  inner join ${games} on ${games.id} = ${gameParticipants.gameId}
  where ${gameParticipants.riotAccountId} = ${riotAccounts.id}
  and ${games.excludedAt} is null)`;

export async function autocompleteStoredNicknames(input: string) {
  await assertSession();
  return autocompleteAccounts(input);
}

async function autocompleteAccounts(
  input: string,
  context?: CacheContext | null,
) {
  const prefix = normalizeNicknamePrefix(input);
  if (!prefix) return [];
  return queryNicknameAutocomplete(
    prefix,
    () =>
      db
        .select({
          id: riotAccounts.id,
          gameName: riotAccounts.gameName,
          tagLine: riotAccounts.tagLine,
        })
        .from(riotAccounts)
        .where(and(isNotNull(riotAccounts.memberId), activeHistory)),
    context,
  );
}

const queryMemberAutocomplete = createAutocompleteIndex<MemberSuggestion>({
  namespace: "member-autocomplete:v1",
  scopes: ["members", "accounts"],
  indexedName: memberIndexKey,
  project(value) {
    const safe = projectSearchSuggestion(value);
    return safe?.kind === "member" ? safe : null;
  },
});

/** One batch query, including members without accounts or active games. */
async function loadSearchMembers(): Promise<MemberSuggestion[]> {
  const rows = await db
    .select({
      id: members.id,
      name: members.name,
      accountId: riotAccounts.id,
      gameName: riotAccounts.gameName,
      tagLine: riotAccounts.tagLine,
    })
    .from(members)
    .leftJoin(riotAccounts, eq(riotAccounts.memberId, members.id));
  rows.sort((a, b) =>
    compareSearchText(
      nicknameIndexKey({
        id: a.accountId ?? "",
        gameName: a.gameName ?? "",
        tagLine: a.tagLine ?? "",
      }),
      nicknameIndexKey({
        id: b.accountId ?? "",
        gameName: b.gameName ?? "",
        tagLine: b.tagLine ?? "",
      }),
    ),
  );
  const grouped = new Map<string, MemberSuggestion>();
  for (const row of rows) {
    let member = grouped.get(row.id);
    if (!member) {
      member = { kind: "member", id: row.id, name: row.name, accounts: [] };
      grouped.set(row.id, member);
    }
    if (
      row.accountId &&
      row.gameName !== null &&
      row.tagLine !== null &&
      member.accounts.length < 2
    ) {
      member.accounts.push({ gameName: row.gameName, tagLine: row.tagLine });
    }
  }
  return [...grouped.values()];
}

export async function autocompleteSearch(input: string) {
  await assertSession();
  const prefix = normalizeSearchInput(input);
  if (!prefix) return [];
  // A failed source rejects the whole request; partial results hide real matches.
  const context = await prepareCache([
    "members",
    "accounts",
    "riot-eligibility",
  ]);
  const [memberMatches, accounts] = await Promise.all([
    queryMemberAutocomplete(
      prefix,
      loadSearchMembers,
      cacheDependencies(context, ["members", "accounts"]),
    ),
    autocompleteAccounts(
      input,
      cacheDependencies(context, ["accounts", "riot-eligibility"]),
    ),
  ]);
  return mergeSearchSuggestions([
    ...memberMatches,
    ...accounts.map((account) => ({
      kind: "riot-account" as const,
      ...account,
    })),
  ]);
}

export type NicknameMemberResolution =
  | { kind: "member"; memberId: string }
  | { kind: "missing" }
  | {
      kind: "ambiguous";
      members: MemberSuggestion[];
      total: number;
      page: number;
      pageCount: number;
    };

/** Resolve current links and names from PostgreSQL, never an autocomplete snapshot. */
export async function resolveSearchMember(
  input: SearchInput | null,
  requestedPage = 1,
): Promise<NicknameMemberResolution> {
  await assertSession();
  const normalized = input && normalizeSearchInput(input.input);
  if (!input || !normalized) return { kind: "missing" };
  const search = normalizeNicknameSearch(input.input);
  // Separate indexed sources avoid an OR over the entire members table. UNION
  // deduplicates member IDs before the count and LIMIT (never account rows).
  const matching = db.$with("matching_members").as(
    union(
      db
        .select({ memberId: members.id })
        .from(members)
        .where(
          input.mode === "unified"
            ? eq(members.normalizedName, normalized)
            : sql`false`,
        ),
      db
        .select({
          memberId: sql<string>`${riotAccounts.memberId}`.as("member_id"),
        })
        .from(riotAccounts)
        .where(
          search
            ? and(
                eq(riotAccounts.normalizedGameName, search.gameName),
                search.tagLine === null
                  ? undefined
                  : eq(riotAccounts.normalizedTagLine, search.tagLine),
                isNotNull(riotAccounts.memberId),
                activeHistory,
              )
            : sql`false`,
        ),
    ),
  );
  const [{ total }] = await db
    .with(matching)
    .select({ total: count() })
    .from(matching);
  if (total === 0) return { kind: "missing" };
  const pageCount = Math.ceil(total / 20);
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? Math.min(requestedPage, pageCount)
      : 1;
  const selected = db
    .with(matching)
    .select({
      id: members.id,
      name: members.name,
      normalizedName: members.normalizedName,
    })
    .from(matching)
    .innerJoin(members, eq(members.id, matching.memberId))
    .orderBy(sql`${members.normalizedName} collate "C"`, asc(members.id))
    .limit(20)
    .offset((page - 1) * 20)
    .as("selected_members");
  // A lateral LIMIT keeps even a member with thousands of accounts to two
  // previews. Sorting the combined Riot ID preserves the autocomplete order.
  const previews = db
    .select({
      id: riotAccounts.id,
      gameName: riotAccounts.gameName,
      tagLine: riotAccounts.tagLine,
      orderKey:
        sql<string>`(${riotAccounts.normalizedGameName} || '#' || ${riotAccounts.normalizedTagLine}) collate "C"`.as(
          "order_key",
        ),
    })
    .from(riotAccounts)
    .where(eq(riotAccounts.memberId, selected.id))
    .orderBy(
      sql`(${riotAccounts.normalizedGameName} || '#' || ${riotAccounts.normalizedTagLine}) collate "C"`,
      asc(riotAccounts.id),
    )
    .limit(2)
    .as("previews");
  const rows = await db
    .select({
      id: selected.id,
      name: selected.name,
      accountId: previews.id,
      gameName: previews.gameName,
      tagLine: previews.tagLine,
    })
    .from(selected)
    .leftJoinLateral(previews, sql`true`)
    .orderBy(
      sql`${selected.normalizedName} collate "C"`,
      asc(selected.id),
      asc(previews.orderKey),
      asc(previews.id),
    );
  if (total === 1)
    return rows.length
      ? { kind: "member", memberId: rows[0].id }
      : { kind: "missing" };
  const grouped = new Map<string, MemberSuggestion>();
  for (const row of rows) {
    const member = grouped.get(row.id) ?? {
      kind: "member" as const,
      id: row.id,
      name: row.name,
      accounts: [],
    };
    if (row.accountId && row.gameName !== null && row.tagLine !== null)
      member.accounts.push({ gameName: row.gameName, tagLine: row.tagLine });
    grouped.set(row.id, member);
  }
  return {
    kind: "ambiguous",
    members: [...grouped.values()],
    total,
    page,
    pageCount,
  };
}

export async function resolveNicknameMember(input: string, page = 1) {
  return resolveSearchMember({ mode: "nickname", input }, page);
}

/** Reusable substring search; navigation uses exact matching above. */
export async function searchStoredNicknames(input: string) {
  const session = await assertSession();
  const search = normalizeNicknameSearch(input);
  if (!search) return [];
  const context = await prepareCache([
    "members",
    "accounts",
    "riot-eligibility",
  ]);
  return cachedQuery(
    {
      policy: "search",
      query: "nickname-search",
      role: session.role,
      args: [search.gameName, search.tagLine],
    },
    async () => {
      const rows = await db
        .select({
          id: riotAccounts.id,
          gameName: riotAccounts.gameName,
          tagLine: riotAccounts.tagLine,
          memberId: riotAccounts.memberId,
          memberName: members.name,
        })
        .from(riotAccounts)
        .innerJoin(members, eq(members.id, riotAccounts.memberId))
        .where(activeHistory)
        .orderBy(
          asc(riotAccounts.gameName),
          asc(riotAccounts.tagLine),
          asc(riotAccounts.id),
        );
      return rows
        .filter(
          (row) =>
            normalizeNicknamePart(row.gameName).includes(search.gameName) &&
            (search.tagLine === null ||
              normalizeNicknamePart(row.tagLine) === search.tagLine),
        )
        .slice(0, 20);
    },
    context,
  );
}
