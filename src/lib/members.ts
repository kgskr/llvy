import "server-only";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  adminCredentials,
  gameParticipants,
  games,
  members,
  riotAccounts,
} from "@/db/schema";

export type MemberWithAccounts = {
  id: string;
  name: string;
  birthYear: number | null;
  accounts: { id: string; gameName: string; tagLine: string }[];
};

export type AdminMemberWithAccounts = MemberWithAccounts & {
  administrator: boolean;
};

export type UnlinkedAccount = {
  id: string;
  gameName: string;
  tagLine: string;
  gameCount: number;
};

/** All members with their linked Riot accounts, ordered by name. */
export async function listMembersWithAccounts(
  limit?: number,
  offset = 0,
): Promise<AdminMemberWithAccounts[]> {
  const selection = db
    .select()
    .from(members)
    .orderBy(asc(members.name), asc(members.id))
    .$dynamic();
  if (limit !== undefined)
    selection
      .limit(
        Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 10,
      )
      .offset(Number.isSafeInteger(offset) ? Math.max(0, offset) : 0);
  const memberPage = selection.as("member_page");
  const rows = await db
    .select({
      id: memberPage.id,
      name: memberPage.name,
      birthYear: memberPage.birthYear,
      administrator: sql<boolean>`exists (select 1 from ${adminCredentials}
        where ${adminCredentials.memberId} = ${memberPage.id} and ${adminCredentials.revokedAt} is null)`,
      accountId: riotAccounts.id,
      gameName: riotAccounts.gameName,
      tagLine: riotAccounts.tagLine,
    })
    .from(memberPage)
    .leftJoin(riotAccounts, eq(riotAccounts.memberId, memberPage.id))
    .orderBy(
      asc(memberPage.name),
      asc(memberPage.id),
      asc(riotAccounts.gameName),
      asc(riotAccounts.id),
    );

  const byMember = new Map<string, AdminMemberWithAccounts>();
  for (const row of rows) {
    let member = byMember.get(row.id);
    if (!member) {
      member = {
        id: row.id,
        name: row.name,
        birthYear: row.birthYear,
        administrator: row.administrator,
        accounts: [],
      };
      byMember.set(row.id, member);
    }
    if (row.accountId && row.gameName !== null) {
      member.accounts.push({
        id: row.accountId,
        gameName: row.gameName,
        tagLine: row.tagLine ?? "",
      });
    }
  }
  return [...byMember.values()];
}

/** Riot accounts not yet linked to a member, with how many games they appear in. */
export async function listUnlinkedAccounts(
  limit?: number,
  offset = 0,
): Promise<UnlinkedAccount[]> {
  const query = db
    .select({
      id: riotAccounts.id,
      gameName: riotAccounts.gameName,
      tagLine: riotAccounts.tagLine,
      gameCount: sql<number>`count(${gameParticipants.id})::int`,
    })
    .from(riotAccounts)
    .innerJoin(
      gameParticipants,
      eq(gameParticipants.riotAccountId, riotAccounts.id),
    )
    .innerJoin(games, eq(games.id, gameParticipants.gameId))
    .where(and(isNull(riotAccounts.memberId), isNull(games.excludedAt)))
    .groupBy(riotAccounts.id)
    .orderBy(
      desc(sql`count(${gameParticipants.id})`),
      asc(riotAccounts.gameName),
      asc(riotAccounts.id),
    )
    .$dynamic();
  if (limit !== undefined)
    query
      .limit(
        Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 10,
      )
      .offset(Number.isSafeInteger(offset) ? Math.max(0, offset) : 0);
  return query;
}

export async function countMembers(): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(members);
  return row.total;
}

export async function listMemberOptions(): Promise<
  { id: string; name: string }[]
> {
  return db
    .select({ id: members.id, name: members.name })
    .from(members)
    .orderBy(asc(members.name), asc(members.id));
}

export async function countUnlinkedAccounts(): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(distinct ${riotAccounts.id})::int` })
    .from(riotAccounts)
    .innerJoin(
      gameParticipants,
      eq(gameParticipants.riotAccountId, riotAccounts.id),
    )
    .innerJoin(games, eq(games.id, gameParticipants.gameId))
    .where(and(isNull(riotAccounts.memberId), isNull(games.excludedAt)));
  return row.total;
}

export async function createMember(
  name: string,
  birthYear: number | null,
): Promise<string> {
  const rows = await db
    .insert(members)
    .values({ name, birthYear })
    .returning({ id: members.id });
  return rows[0].id;
}

/** Edit member details without changing the identity used by linked accounts. */
export async function updateMember(
  id: string,
  name: string,
  birthYear: number | null,
): Promise<boolean> {
  const rows = await db
    .update(members)
    .set({ name, birthYear })
    .where(eq(members.id, id))
    .returning({ id: members.id });
  return rows.length > 0;
}

/** Link a Riot account to a member. Retroactively resolves past participants. */
export async function linkAccount(
  accountId: string,
  memberId: string,
): Promise<boolean> {
  const rows = await db
    .update(riotAccounts)
    .set({ memberId, linkedAt: new Date() })
    .where(eq(riotAccounts.id, accountId))
    .returning({ id: riotAccounts.id });
  return rows.length > 0;
}

export async function unlinkAccount(accountId: string): Promise<boolean> {
  const rows = await db
    .update(riotAccounts)
    .set({ memberId: null, linkedAt: null })
    .where(eq(riotAccounts.id, accountId))
    .returning({ id: riotAccounts.id });
  return rows.length > 0;
}
