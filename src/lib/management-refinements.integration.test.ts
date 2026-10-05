import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  adminCredentials,
  auditLogs,
  gameParticipants,
  games,
  members,
  riotAccounts,
} from "@/db/schema";
import {
  client,
  db,
  migrateTestDatabase,
  resetTestDatabase,
} from "@/test/database";

const mocks = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => ({ db: (await import("@/test/database")).db }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (mocks.token ? { value: mocks.token } : undefined),
  }),
}));

import { createSessionToken } from "./auth";
import {
  authenticateAccessKey,
  grantAdminCredential,
  revokeAdminCredential,
} from "./admin-credentials";
import {
  setGameComment,
  setGameExcluded,
  setGamePlayedAt,
} from "./game-mutations";
import { getGameDetail, listGames } from "./games";
import { ActiveAdministratorError, deleteMember } from "./member-mutations";
import {
  countMembers,
  countUnlinkedAccounts,
  listMemberOptions,
  listMembersWithAccounts,
  listUnlinkedAccounts,
} from "./members";
import { ForbiddenError, UnauthorizedError } from "./session";

beforeAll(migrateTestDatabase, 30_000);
beforeEach(async () => {
  await resetTestDatabase();
  vi.stubEnv("READ_PASSWORD", "refinement-viewer-key");
  vi.stubEnv("OWNER_PASSWORD", "refinement-owner-private-key");
  vi.stubEnv("AUTH_SECRET", "independent-refinement-signing-secret-32-bytes");
  mocks.token = await createSessionToken("owner");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => client.close());

async function member(name = "김모임원") {
  const [row] = await db
    .insert(members)
    .values({ name, birthYear: 1990 })
    .returning();
  return row;
}

async function administrator(name = "이관리자") {
  const row = await member(name);
  const issued = await grantAdminCredential(row.id);
  const actor = (await authenticateAccessKey(issued.key))!;
  return { row, issued, actor, token: await createSessionToken(actor) };
}

async function account(name: string, memberId: string | null = null) {
  const [row] = await db
    .insert(riotAccounts)
    .values({
      gameName: name,
      tagLine: "KR1",
      puuid: randomUUID(),
      memberId,
      linkedAt: memberId ? new Date("2026-10-01T00:00:00Z") : null,
    })
    .returning();
  return row;
}

async function game(accountIds: string[] = [], excluded = false) {
  const [row] = await db
    .insert(games)
    .values({
      fileHash: randomUUID(),
      blobUrl: `https://example.invalid/${randomUUID()}.rofl`,
      playedAt: "2026-10-01",
      playedAtSource: "file_mtime",
      durationMs: 1200000,
      excludedAt: excluded ? new Date("2026-10-02T00:00Z") : null,
    })
    .returning();
  if (accountIds.length)
    await db.insert(gameParticipants).values(
      accountIds.map((id) => ({
        gameId: row.id,
        riotAccountId: id,
        team: 100,
        champion: "Ahri",
        kills: 5,
      })),
    );
  return row;
}

async function snapshot() {
  const [memberRows, accountRows, credentials, gameRows, participants, audit] =
    await Promise.all([
      db.select().from(members).orderBy(members.id),
      db.select().from(riotAccounts).orderBy(riotAccounts.id),
      db.select().from(adminCredentials).orderBy(adminCredentials.id),
      db.select().from(games).orderBy(games.id),
      db.select().from(gameParticipants).orderBy(gameParticipants.id),
      db.select().from(auditLogs).orderBy(auditLogs.id),
    ]);
  return {
    memberRows,
    accountRows,
    credentials,
    gameRows,
    participants,
    audit,
  };
}

async function brokenAudit(work: () => Promise<void>) {
  await client.exec(`
    CREATE FUNCTION reject_refinement_audit() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'test refinement audit failure'; END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER reject_refinement_audit BEFORE INSERT ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION reject_refinement_audit();
  `);
  try {
    await work();
  } finally {
    await client.exec(
      "DROP TRIGGER reject_refinement_audit ON audit_logs; DROP FUNCTION reject_refinement_audit();",
    );
  }
}

describe("protected permanent member deletion", () => {
  it.each(["admin", "owner"] as const)(
    "allows %s to delete a non-administrator while preserving game and account history",
    async (role) => {
      const actor = await administrator();
      const target = await member();
      const main = await account("Main account", target.id);
      const alternate = await account("Alternate account", target.id);
      const stored = await game([main.id, alternate.id]);
      const before = await snapshot();
      mocks.token =
        role === "admin" ? actor.token : await createSessionToken("owner");
      expect(await deleteMember(target.id)).toBe(true);
      expect(await countMembers()).toBe(1);
      expect((await db.select().from(members)).map((row) => row.id)).toEqual([
        actor.row.id,
      ]);
      const after = await snapshot();
      expect(after.gameRows).toEqual(before.gameRows);
      expect(after.participants).toEqual(before.participants);
      expect(after.accountRows).toHaveLength(2);
      for (const linked of after.accountRows)
        expect(linked).toMatchObject({ memberId: null, linkedAt: null });
      expect(
        (await getGameDetail(stored.id))?.participants.every(
          (row) => row.memberId === null && row.memberName === null,
        ),
      ).toBe(true);
      expect(
        after.audit.filter((entry) => entry.action === "member.deleted"),
      ).toEqual([
        expect.objectContaining({
          actorRole: role,
          targetId: target.id,
          before: { name: target.name, birthYear: 1990 },
        }),
      ]);
      expect(
        after.audit.filter((entry) => entry.action === "account.unlinked"),
      ).toHaveLength(2);
      expect(after.audit).toEqual(expect.arrayContaining(before.audit));
    },
  );

  it.each(["admin", "owner"] as const)(
    "rejects %s deletion of an active administrator without changing any row",
    async (role) => {
      const actor = await administrator();
      const target = await administrator("박대상");
      await account("Protected linked account", target.row.id);
      mocks.token =
        role === "admin" ? actor.token : await createSessionToken("owner");
      const before = await snapshot();
      await expect(deleteMember(target.row.id)).rejects.toBeInstanceOf(
        ActiveAdministratorError,
      );
      expect(await snapshot()).toEqual(before);
    },
  );

  it("deletes a revoked administrator and its old credentials but preserves audit identity snapshots", async () => {
    const actor = await administrator();
    const target = await administrator("박이전관리자");
    const linked = await account("Former admin account", target.row.id);
    const stored = await game([linked.id]);
    expect(await revokeAdminCredential(target.row.id)).toBe(true);
    const before = await snapshot();
    mocks.token = actor.token;
    expect(await deleteMember(target.row.id)).toBe(true);
    const after = await snapshot();
    expect(after.credentials.map((row) => row.memberId)).toEqual([
      actor.row.id,
    ]);
    expect(after.accountRows[0]).toMatchObject({
      id: linked.id,
      memberId: null,
      linkedAt: null,
    });
    expect(after.gameRows).toEqual(before.gameRows);
    expect(after.participants).toEqual(before.participants);
    expect(after.audit).toEqual(expect.arrayContaining(before.audit));
    expect(
      (await getGameDetail(stored.id))?.participants[0].memberName,
    ).toBeNull();
    expect(await authenticateAccessKey(target.issued.key)).toBeNull();
    mocks.token = target.token;
    await expect(deleteMember(actor.row.id)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it.each(["first_unlink", "member_delete"] as const)(
    "rolls every delete side effect back when the %s audit fails",
    async (stage) => {
      const target = await administrator("박이전관리자");
      await revokeAdminCredential(target.row.id);
      await account("Rollback main", target.row.id);
      await account("Rollback alternate", target.row.id);
      const before = await snapshot();
      if (stage === "first_unlink") {
        await brokenAudit(async () => {
          await expect(deleteMember(target.row.id)).rejects.toThrow();
          expect(await snapshot()).toEqual(before);
        });
      } else {
        // Fail only the final deletion event, after account audits, credential
        // removal and member deletion have all run inside the transaction.
        await client.exec(`
        CREATE FUNCTION reject_refinement_final_delete() RETURNS trigger AS $$
        BEGIN IF NEW.action = 'member.deleted' THEN RAISE EXCEPTION 'test final audit failure'; END IF; RETURN NEW; END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER reject_refinement_final_delete BEFORE INSERT ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION reject_refinement_final_delete();
      `);
        try {
          await expect(deleteMember(target.row.id)).rejects.toThrow();
          expect(await snapshot()).toEqual(before);
        } finally {
          await client.exec(
            "DROP TRIGGER reject_refinement_final_delete ON audit_logs; DROP FUNCTION reject_refinement_final_delete();",
          );
        }
      }
    },
  );

  it.each(["viewer", "revoked", "missing"] as const)(
    "blocks %s deletion before any side effect",
    async (kind) => {
      const actor = await administrator();
      const target = await member();
      await account("Unauthorized account", target.id);
      if (kind === "revoked") await revokeAdminCredential(actor.row.id);
      mocks.token =
        kind === "viewer"
          ? await createSessionToken("viewer")
          : kind === "revoked"
            ? actor.token
            : undefined;
      const before = await snapshot();
      await expect(deleteMember(target.id)).rejects.toBeInstanceOf(
        kind === "viewer" ? ForbiddenError : UnauthorizedError,
      );
      expect(await snapshot()).toEqual(before);
    },
  );

  it("returns false for invalid or nonexistent targets without recording deletion", async () => {
    for (const id of ["invalid-id", randomUUID()])
      expect(await deleteMember(id)).toBe(false);
    expect(await db.select().from(auditLogs)).toEqual([]);
  });
});

describe("active-game unlinked account queue", () => {
  it("counts only active appearances and restores excluded-only accounts when their game is restored", async () => {
    const both = await account("Both visibility states");
    const excludedOnly = await account("Excluded only");
    const noGame = await account("No games");
    const target = await member();
    const linked = await account("Linked member", target.id);
    const active = await game([both.id, linked.id]);
    const excluded = await game([both.id, excludedOnly.id], true);
    expect(await countUnlinkedAccounts()).toBe(1);
    expect(await listUnlinkedAccounts()).toEqual([
      { id: both.id, gameName: both.gameName, tagLine: "KR1", gameCount: 1 },
    ]);
    expect(await setGameExcluded(excluded.id, false)).toBe(true);
    expect(await countUnlinkedAccounts()).toBe(2);
    expect(await listUnlinkedAccounts()).toEqual([
      { id: both.id, gameName: both.gameName, tagLine: "KR1", gameCount: 2 },
      {
        id: excludedOnly.id,
        gameName: excludedOnly.gameName,
        tagLine: "KR1",
        gameCount: 1,
      },
    ]);
    await setGameExcluded(active.id, true);
    await setGameExcluded(excluded.id, true);
    expect(await listUnlinkedAccounts()).toEqual([]);
    expect(await countUnlinkedAccounts()).toBe(0);
    expect(
      (await db.select().from(riotAccounts)).map((row) => row.id),
    ).toContain(noGame.id);
    expect(await db.select().from(gameParticipants)).toHaveLength(4);
  });

  it("paginates stable account ordering with active totals and complete counts", async () => {
    const accounts = await Promise.all(
      Array.from({ length: 23 }, (_, index) =>
        account(`Queue ${String(index).padStart(2, "0")}`),
      ),
    );
    await game(accounts.map((row) => row.id));
    await game([accounts[0].id]);
    await game([accounts[0].id], true);
    expect(await countUnlinkedAccounts()).toBe(23);
    const all = await listUnlinkedAccounts();
    const first = await listUnlinkedAccounts(10, 0);
    const second = await listUnlinkedAccounts(10, 10);
    const third = await listUnlinkedAccounts(10, 20);
    expect([first.length, second.length, third.length]).toEqual([10, 10, 3]);
    expect([...first, ...second, ...third]).toEqual(all);
    expect(await listUnlinkedAccounts(10, 10)).toEqual(second);
    expect(all[0]).toMatchObject({ id: accounts[0].id, gameCount: 2 });
    expect(await listUnlinkedAccounts(10, 30)).toEqual([]);
  });
});

describe("SQL member paging with complete accounts and options", () => {
  it("paginates ten members before joining and retains stable ties and every member option", async () => {
    const ids = Array.from(
      { length: 23 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    await db.insert(members).values(
      ids.map((id, index) => ({
        id,
        name:
          index < 2 ? "Member 00" : `Member ${String(index).padStart(2, "0")}`,
      })),
    );
    const many = await Promise.all(
      Array.from({ length: 17 }, (_, index) =>
        account(`Alt ${String(index).padStart(2, "0")}`, ids[0]),
      ),
    );
    await grantAdminCredential(ids[11]);
    expect(await countMembers()).toBe(23);
    const all = await listMembersWithAccounts();
    const first = await listMembersWithAccounts(10, 0);
    const second = await listMembersWithAccounts(10, 10);
    const third = await listMembersWithAccounts(10, 20);
    expect([first.length, second.length, third.length]).toEqual([10, 10, 3]);
    expect([...first, ...second, ...third]).toEqual(all);
    expect(all.map((row) => row.id)).toEqual(ids);
    expect(first[0].accounts.map((row) => row.id)).toEqual(
      many.map((row) => row.id),
    );
    expect(first[0].accounts).toHaveLength(17);
    expect(second.find((row) => row.id === ids[11])?.administrator).toBe(true);
    expect(first.every((row) => row.administrator === false)).toBe(true);
    expect(await listMembersWithAccounts(10, 10)).toEqual(second);
    expect(await listMemberOptions()).toEqual(
      all.map(({ id, name }) => ({ id, name })),
    );
    expect(await listMembersWithAccounts(10, 30)).toEqual([]);
    await deleteMember(ids.at(-1)!);
    expect(await countMembers()).toBe(22);
    expect(await listMemberOptions()).toHaveLength(22);
  });
});

describe("date-only corrections and shared game comments", () => {
  it.each(["admin", "owner"] as const)(
    "allows %s to preserve 30 code points with spaces, replace and clear the comment",
    async (role) => {
      const actor = await administrator();
      const stored = await game();
      mocks.token =
        role === "admin" ? actor.token : await createSessionToken("owner");
      const comment = ` ${"😀".repeat(28)} `;
      expect([...comment]).toHaveLength(30);
      expect(await setGameComment(stored.id, comment)).toBe(true);
      expect((await getGameDetail(stored.id))?.comment).toBe(comment);
      expect((await listGames())[0].comment).toBe(comment);
      let changes = (await db.select().from(auditLogs)).filter(
        (entry) => entry.action === "game.comment_updated",
      );
      expect(changes[0]).toMatchObject({
        actorRole: role,
        targetId: stored.id,
        before: { comment: null },
        after: { comment },
      });
      expect(await setGameComment(stored.id, "수정한 코멘트")).toBe(true);
      expect((await getGameDetail(stored.id))?.comment).toBe("수정한 코멘트");
      expect(await setGameComment(stored.id, "")).toBe(true);
      expect((await getGameDetail(stored.id))?.comment).toBeNull();
      changes = (await db.select().from(auditLogs)).filter(
        (entry) => entry.action === "game.comment_updated",
      );
      expect(changes).toHaveLength(3);
      expect(changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            before: { comment: "수정한 코멘트" },
            after: { comment: null },
          }),
        ]),
      );
    },
  );

  it("rejects 31 Unicode characters at the service and DB boundaries without altering data or audits", async () => {
    const stored = await game();
    const before = await snapshot();
    for (const value of ["가".repeat(31), "😀".repeat(31), " ".repeat(31)]) {
      expect(await setGameComment(stored.id, value)).toBe(false);
      await expect(
        db.update(games).set({ comment: value }).where(eq(games.id, stored.id)),
      ).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
    }
    expect(await setGameComment(randomUUID(), "대상 없음")).toBe(false);
    expect(await snapshot()).toEqual(before);
  });

  it("rolls back a comment replacement when its audit cannot be stored", async () => {
    const stored = await game();
    await setGameComment(stored.id, "이전 코멘트");
    const before = await snapshot();
    await brokenAudit(async () => {
      await expect(
        setGameComment(stored.id, "롤백할 코멘트"),
      ).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
    });
  });

  it.each(["viewer", "revoked", "missing"] as const)(
    "blocks %s from comment and date mutation",
    async (kind) => {
      const actor = await administrator();
      const stored = await game();
      if (kind === "revoked") await revokeAdminCredential(actor.row.id);
      mocks.token =
        kind === "viewer"
          ? await createSessionToken("viewer")
          : kind === "revoked"
            ? actor.token
            : undefined;
      const before = await snapshot();
      for (const operation of [
        () => setGameComment(stored.id, "권한 없는 변경"),
        () => setGamePlayedAt(stored.id, "2026-10-02"),
      ]) {
        await expect(operation()).rejects.toBeInstanceOf(
          kind === "viewer" ? ForbiddenError : UnauthorizedError,
        );
      }
      expect(await snapshot()).toEqual(before);
    },
  );

  it("stores and audits only the date override and restores the unchanged original day", async () => {
    const stored = await game();
    expect(await setGamePlayedAt(stored.id, "2026-10-02")).toBe(true);
    expect(await getGameDetail(stored.id)).toMatchObject({
      playedAt: "2026-10-02",
      originalPlayedAt: "2026-10-01",
      playedAtOverride: "2026-10-02",
    });
    const [corrected] = await db.select().from(games);
    expect(corrected).toMatchObject({
      playedAt: "2026-10-01",
      playedAtOverride: "2026-10-02",
    });
    expect((await db.select().from(auditLogs))[0]).toMatchObject({
      before: { playedAtOverride: null },
      after: { playedAtOverride: "2026-10-02" },
    });
    const beforeInvalid = await snapshot();
    expect(await setGamePlayedAt(stored.id, "2026-10-02T12:00")).toBe(false);
    expect(await snapshot()).toEqual(beforeInvalid);
    expect(await setGamePlayedAt(stored.id, null)).toBe(true);
    expect(await getGameDetail(stored.id)).toMatchObject({
      playedAt: "2026-10-01",
      playedAtOverride: null,
    });
  });
});
