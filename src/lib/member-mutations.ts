import "server-only";

import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { adminCredentials, members, riotAccounts } from "@/db/schema";
import { appendAudit, withActorTransaction } from "@/lib/audit";
import { assertAdmin } from "@/lib/session";
import { isUuid } from "@/lib/validation";

export class ActiveAdministratorError extends Error {}

export async function createMember(
  name: string,
  birthYear: number | null,
): Promise<string> {
  const actor = await assertAdmin();
  return withActorTransaction(actor, async (tx) => {
    const [row] = await tx
      .insert(members)
      .values({ name, birthYear })
      .returning({ id: members.id });
    await appendAudit(tx, actor, {
      action: "member.created",
      targetType: "member",
      targetId: row.id,
      after: { name, birthYear },
    });
    return row.id;
  });
}

export async function updateMember(
  id: string,
  name: string,
  birthYear: number | null,
): Promise<boolean> {
  const actor = await assertAdmin();
  return withActorTransaction(actor, async (tx) => {
    const [before] = await tx
      .select({ name: members.name, birthYear: members.birthYear })
      .from(members)
      .where(eq(members.id, id))
      .for("update");
    if (!before) return false;
    await tx.update(members).set({ name, birthYear }).where(eq(members.id, id));
    await appendAudit(tx, actor, {
      action: "member.updated",
      targetType: "member",
      targetId: id,
      before,
      after: { name, birthYear },
    });
    return true;
  });
}

async function changeAccountLink(
  accountId: string,
  memberId: string | null,
): Promise<boolean> {
  const actor = await assertAdmin();
  return withActorTransaction(actor, async (tx) => {
    // Target member before account, matching deletion's lock order.
    if (memberId !== null) {
      const [member] = await tx
        .select({ id: members.id })
        .from(members)
        .where(eq(members.id, memberId))
        .for("share");
      if (!member) return false;
    }
    const [before] = await tx
      .select({ memberId: riotAccounts.memberId })
      .from(riotAccounts)
      .where(eq(riotAccounts.id, accountId))
      .for("update");
    if (!before) return false;
    await tx
      .update(riotAccounts)
      .set({ memberId, linkedAt: memberId ? new Date() : null })
      .where(eq(riotAccounts.id, accountId));
    await appendAudit(tx, actor, {
      action: memberId ? "account.linked" : "account.unlinked",
      targetType: "account",
      targetId: accountId,
      before,
      after: { memberId },
    });
    return true;
  });
}

export function linkAccount(
  accountId: string,
  memberId: string,
): Promise<boolean> {
  return changeAccountLink(accountId, memberId);
}
export function unlinkAccount(accountId: string): Promise<boolean> {
  return changeAccountLink(accountId, null);
}

/** Actual deletion; game/account history and audit snapshots survive. */
export async function deleteMember(id: string): Promise<boolean> {
  const actor = await assertAdmin();
  if (!isUuid(id)) return false;
  return withActorTransaction(actor, async (tx) => {
    const [before] = await tx
      .select({ name: members.name, birthYear: members.birthYear })
      .from(members)
      .where(eq(members.id, id))
      .for("update");
    if (!before) return false;
    const [active] = await tx
      .select({ id: adminCredentials.id })
      .from(adminCredentials)
      .where(
        and(
          eq(adminCredentials.memberId, id),
          isNull(adminCredentials.revokedAt),
        ),
      );
    if (active) throw new ActiveAdministratorError();
    const detached = await tx
      .update(riotAccounts)
      .set({ memberId: null, linkedAt: null })
      .where(eq(riotAccounts.memberId, id))
      .returning({ id: riotAccounts.id });
    for (const account of detached) {
      await appendAudit(tx, actor, {
        action: "account.unlinked",
        targetType: "account",
        targetId: account.id,
        before: { memberId: id },
        after: { memberId: null, reason: "member_deleted" },
      });
    }
    await tx
      .delete(adminCredentials)
      .where(
        and(
          eq(adminCredentials.memberId, id),
          isNotNull(adminCredentials.revokedAt),
        ),
      );
    await tx.delete(members).where(eq(members.id, id));
    await appendAudit(tx, actor, {
      action: "member.deleted",
      targetType: "member",
      targetId: id,
      before,
    });
    return true;
  });
}
