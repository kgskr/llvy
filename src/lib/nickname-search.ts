import "server-only";

import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { gameParticipants, games, members, riotAccounts } from "@/db/schema";
import { memberDisplayName } from "@/lib/member-privacy";
import { cachedQuery } from "@/lib/query-cache";
import { assertSession } from "@/lib/session";
import {
  normalizeNicknamePart,
  normalizeNicknamePrefix,
  queryNicknameAutocomplete,
} from "@/lib/nickname-autocomplete";
export type { NicknameSuggestion } from "@/lib/nickname-autocomplete";

export type NicknameSearch = { gameName: string; tagLine: string | null };

export function normalizeNicknameSearch(input: string): NicknameSearch | null {
  const value = normalizeNicknamePart(input);
  if (!value || [...value].length > 100 || /[\u0000-\u001f\u007f]/u.test(value))
    return null;
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
  const prefix = normalizeNicknamePrefix(input);
  if (!prefix) return [];
  return queryNicknameAutocomplete(prefix, () =>
    db
      .select({
        id: riotAccounts.id,
        gameName: riotAccounts.gameName,
        tagLine: riotAccounts.tagLine,
      })
      .from(riotAccounts)
      .where(and(isNotNull(riotAccounts.memberId), activeHistory)),
  );
}

export type NicknameMemberResolution =
  | { kind: "member"; memberId: string }
  | { kind: "missing" }
  | {
      kind: "ambiguous";
      accounts: {
        id: string;
        gameName: string;
        tagLine: string;
        memberId: string;
        memberName: string;
      }[];
    };

/** Resolve current links from PostgreSQL, even with a warm autocomplete index. */
export async function resolveNicknameMember(
  input: string,
): Promise<NicknameMemberResolution> {
  const session = await assertSession();
  const search = normalizeNicknameSearch(input);
  if (!search) return { kind: "missing" };
  const eligible = await db
    .select({
      id: riotAccounts.id,
      gameName: riotAccounts.gameName,
      tagLine: riotAccounts.tagLine,
      memberId: members.id,
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
  // Use the same Unicode normalization as the Valkey index. Database LOWER
  // depends on collation and differs for e.g. Greek sigma and Turkish dotted I.
  const rows = eligible.filter(
    (row) =>
      normalizeNicknamePart(row.gameName) === search.gameName &&
      (search.tagLine === null ||
        normalizeNicknamePart(row.tagLine) === search.tagLine),
  );
  const memberIds = new Set(rows.map((row) => row.memberId));
  if (memberIds.size === 0) return { kind: "missing" };
  if (memberIds.size === 1)
    return { kind: "member", memberId: rows[0].memberId };
  return {
    kind: "ambiguous",
    accounts: rows.slice(0, 20).map((row) => ({
      ...row,
      memberName: memberDisplayName(row.memberName, session.role),
    })),
  };
}

/** Reusable substring search; navigation uses exact matching above. */
export async function searchStoredNicknames(input: string) {
  const session = await assertSession();
  const search = normalizeNicknameSearch(input);
  if (!search) return [];
  return cachedQuery(
    {
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
        .slice(0, 20)
        .map((row) => ({
          ...row,
          memberName:
            row.memberName === null
              ? null
              : memberDisplayName(row.memberName, session.role),
        }));
    },
  );
}
