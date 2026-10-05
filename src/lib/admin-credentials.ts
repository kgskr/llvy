import "server-only";

import { createHash, randomInt } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { adminCredentials, members } from "@/db/schema";
import { authenticatePassword, type Actor } from "@/lib/auth";
import { appendAudit, withActorTransaction } from "@/lib/audit";
import { isUuid } from "@/lib/validation";

export class CredentialConflictError extends Error {}
export class MemberNotFoundError extends Error {}

export function hashAccessKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateAdminKey(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (;;) {
    const key = Array.from(
      { length: 16 },
      () => alphabet[randomInt(alphabet.length)],
    ).join("");
    if (
      /[A-Z]/.test(key) &&
      /[a-z]/.test(key) &&
      /[0-9]/.test(key) &&
      !authenticatePassword(key)
    )
      return key;
  }
}

export async function findActiveAdmin(
  credentialId: string,
  memberId: string,
): Promise<Actor | null> {
  const [row] = await db
    .select({ name: members.name })
    .from(adminCredentials)
    .innerJoin(members, eq(members.id, adminCredentials.memberId))
    .where(
      and(
        eq(adminCredentials.id, credentialId),
        eq(adminCredentials.memberId, memberId),
        isNull(adminCredentials.revokedAt),
      ),
    )
    .limit(1);
  return row ? { role: "admin", credentialId, memberId, name: row.name } : null;
}

export async function authenticateAccessKey(
  input: string,
): Promise<Actor | null> {
  const role = authenticatePassword(input);
  if (role)
    return {
      role,
      memberId: null,
      credentialId: null,
      name: role === "owner" ? "서비스 오너" : "일반 사용자",
    };
  if (!/^[A-Za-z0-9]{16}$/.test(input)) return null;
  const [row] = await db
    .select({
      id: adminCredentials.id,
      memberId: adminCredentials.memberId,
      name: members.name,
    })
    .from(adminCredentials)
    .innerJoin(members, eq(members.id, adminCredentials.memberId))
    .where(
      and(
        eq(adminCredentials.keyHash, hashAccessKey(input)),
        isNull(adminCredentials.revokedAt),
      ),
    )
    .limit(1);
  return row
    ? {
        role: "admin",
        credentialId: row.id,
        memberId: row.memberId,
        name: row.name,
      }
    : null;
}

export async function grantAdminCredential(
  memberId: string,
): Promise<{ key: string; credentialId: string }> {
  const { assertOwner } = await import("@/lib/session");
  const actor = await assertOwner();
  if (!isUuid(memberId)) throw new MemberNotFoundError();
  return withActorTransaction(actor, async (tx) => {
    const [member] = await tx
      .select({ id: members.id })
      .from(members)
      .where(eq(members.id, memberId))
      .for("update");
    if (!member) throw new MemberNotFoundError();
    const [existing] = await tx
      .select({ id: adminCredentials.id })
      .from(adminCredentials)
      .where(
        and(
          eq(adminCredentials.memberId, memberId),
          isNull(adminCredentials.revokedAt),
        ),
      );
    if (existing) throw new CredentialConflictError();
    const key = generateAdminKey();
    const [created] = await tx
      .insert(adminCredentials)
      .values({ memberId, keyHash: hashAccessKey(key) })
      .returning({ id: adminCredentials.id });
    await appendAudit(tx, actor, {
      action: "admin.granted",
      targetType: "member",
      targetId: memberId,
      after: { administrator: true },
    });
    return { key, credentialId: created.id };
  });
}

export async function revokeAdminCredential(
  memberId: string,
): Promise<boolean> {
  const { assertOwner } = await import("@/lib/session");
  const actor = await assertOwner();
  if (!isUuid(memberId)) throw new MemberNotFoundError();
  return withActorTransaction(actor, async (tx) => {
    // Match mutation order: credential before member. Taking the member first
    // would deadlock with an admin who is editing their own member row.
    await tx
      .select({ id: adminCredentials.id })
      .from(adminCredentials)
      .where(
        and(
          eq(adminCredentials.memberId, memberId),
          isNull(adminCredentials.revokedAt),
        ),
      )
      .for("update");
    // Member lock also serializes this revoke with a new grant.
    const [member] = await tx
      .select({ id: members.id })
      .from(members)
      .where(eq(members.id, memberId))
      .for("update");
    if (!member) throw new MemberNotFoundError();
    const rows = await tx
      .update(adminCredentials)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(adminCredentials.memberId, memberId),
          isNull(adminCredentials.revokedAt),
        ),
      )
      .returning({ id: adminCredentials.id });
    if (!rows.length) return false;
    await appendAudit(tx, actor, {
      action: "admin.revoked",
      targetType: "member",
      targetId: memberId,
      before: { administrator: true },
      after: { administrator: false },
    });
    return true;
  });
}

export async function listAdminAssignments() {
  const { assertOwner } = await import("@/lib/session");
  await assertOwner();
  return db
    .select({
      memberId: adminCredentials.memberId,
      credentialId: adminCredentials.id,
      issuedAt: adminCredentials.issuedAt,
    })
    .from(adminCredentials)
    .where(isNull(adminCredentials.revokedAt));
}
