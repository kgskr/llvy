import "server-only";

import { asc, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  adminCredentials,
  gameParticipants,
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
export async function listMembersWithAccounts(): Promise<
  AdminMemberWithAccounts[]
> {
  const rows = await db
    .select({
      id: members.id,
      name: members.name,
      birthYear: members.birthYear,
      administrator: sql<boolean>`exists (select 1 from ${adminCredentials} where ${adminCredentials.memberId} = ${members.id} and ${adminCredentials.revokedAt} is null)`,
      accountId: riotAccounts.id,
      gameName: riotAccounts.gameName,
      tagLine: riotAccounts.tagLine,
    })
    .from(members)
    .leftJoin(riotAccounts, eq(riotAccounts.memberId, members.id))
    .orderBy(asc(members.name));

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
export async function listUnlinkedAccounts(): Promise<UnlinkedAccount[]> {
  return db
    .select({
      id: riotAccounts.id,
      gameName: riotAccounts.gameName,
      tagLine: riotAccounts.tagLine,
      gameCount: sql<number>`count(${gameParticipants.id})::int`,
    })
    .from(riotAccounts)
    .leftJoin(
      gameParticipants,
      eq(gameParticipants.riotAccountId, riotAccounts.id),
    )
    .where(isNull(riotAccounts.memberId))
    .groupBy(riotAccounts.id)
    .orderBy(
      desc(sql`count(${gameParticipants.id})`),
      asc(riotAccounts.gameName),
      asc(riotAccounts.id),
    );
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
