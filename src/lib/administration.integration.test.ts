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
import { replayBytes } from "@/test/replay";

const mocks = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => ({ db: (await import("@/test/database")).db }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "llvy_session" && mocks.token
        ? { value: mocks.token }
        : undefined,
  }),
}));

import { createSessionToken, type Actor } from "./auth";
import {
  authenticateAccessKey,
  grantAdminCredential,
  revokeAdminCredential,
} from "./admin-credentials";
import { setGameExcluded, setGamePlayedAt } from "./game-mutations";
import { ingestReplay } from "./ingest";
import {
  createMember,
  linkAccount,
  unlinkAccount,
  updateMember,
} from "./member-mutations";
import { createMember as createMemberFixture } from "./members";
import { getSession, UnauthorizedError } from "./session";

const PLAYED_AT = new Date("2026-10-01T12:00:00.000Z");

beforeAll(migrateTestDatabase, 30_000);
beforeEach(async () => {
  await resetTestDatabase();
  vi.stubEnv("READ_PASSWORD", "integration-viewer-key");
  vi.stubEnv("OWNER_PASSWORD", "integration-owner-key");
  vi.stubEnv("AUTH_SECRET", "independent-integration-signing-secret-32-bytes");
  mocks.token = await createSessionToken("owner");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => client.close());

async function assignedAdministrator() {
  const memberId = await createMemberFixture("김관리자", 1990);
  const issued = await grantAdminCredential(memberId);
  const actor = (await authenticateAccessKey(issued.key))!;
  const token = await createSessionToken(actor);
  return { memberId, issued, actor, token };
}

function ingest(actor?: Actor, uploadId?: string, bytes = replayBytes()) {
  return ingestReplay({
    bytes,
    blobUrl: "https://example.invalid/replays/administration.rofl",
    originalFilename: "administration.rofl",
    lastModified: PLAYED_AT.getTime(),
    actor,
    uploadId,
  });
}

async function accountFixture(memberId: string | null = null) {
  const [account] = await db
    .insert(riotAccounts)
    .values({
      gameName: "Audit account",
      tagLine: "KR1",
      puuid: "audit-account-fixture",
      memberId,
      linkedAt: memberId ? PLAYED_AT : null,
    })
    .returning();
  return account;
}

async function event(action: string) {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.action, action));
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function snapshot() {
  const [memberRows, accountRows, gameRows, participants, logs] =
    await Promise.all([
      db.select().from(members).orderBy(members.id),
      db.select().from(riotAccounts).orderBy(riotAccounts.id),
      db.select().from(games).orderBy(games.id),
      db.select().from(gameParticipants).orderBy(gameParticipants.id),
      db.select().from(auditLogs).orderBy(auditLogs.id),
    ]);
  return { memberRows, accountRows, gameRows, participants, logs };
}

async function withBrokenAudit(work: () => Promise<void>) {
  await client.exec(`
    CREATE FUNCTION reject_administration_test_audit() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'test audit storage unavailable'; END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER reject_administration_test_audit BEFORE INSERT ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION reject_administration_test_audit();
  `);
  try {
    await work();
  } finally {
    await client.exec(`
      DROP TRIGGER reject_administration_test_audit ON audit_logs;
      DROP FUNCTION reject_administration_test_audit();
    `);
  }
}

describe("attributed administrative changes with real sessions", () => {
  it("attributes member creation, editing and account links to the signed administrator with accurate changes", async () => {
    const administrator = await assignedAdministrator();
    mocks.token = administrator.token;
    const memberId = await createMember("김회원", 1995);
    const created = await event("member.created");
    expect(created).toMatchObject({
      actorRole: "admin",
      actorMemberId: administrator.memberId,
      actorCredentialId: administrator.issued.credentialId,
      actorName: "김관리자",
      targetType: "member",
      targetId: memberId,
      result: "success",
      before: null,
      after: { name: "김회원", birthYear: 1995 },
    });
    expect(created.requestId).toMatch(/^[0-9a-f-]{36}$/);

    expect(await updateMember(memberId, "김수정", null)).toBe(true);
    expect(await event("member.updated")).toMatchObject({
      actorMemberId: administrator.memberId,
      actorName: "김관리자",
      targetId: memberId,
      before: { name: "김회원", birthYear: 1995 },
      after: { name: "김수정", birthYear: null },
    });
    const account = await accountFixture();
    expect(await linkAccount(account.id, memberId)).toBe(true);
    expect(await event("account.linked")).toMatchObject({
      actorRole: "admin",
      actorMemberId: administrator.memberId,
      actorCredentialId: administrator.issued.credentialId,
      targetType: "account",
      targetId: account.id,
      before: { memberId: null },
      after: { memberId },
    });
    const [linked] = await db
      .select()
      .from(riotAccounts)
      .where(eq(riotAccounts.id, account.id));
    expect(linked.linkedAt).toBeInstanceOf(Date);
    expect(await unlinkAccount(account.id)).toBe(true);
    expect(await event("account.unlinked")).toMatchObject({
      actorMemberId: administrator.memberId,
      targetId: account.id,
      before: { memberId },
      after: { memberId: null },
    });
    const [unlinked] = await db
      .select()
      .from(riotAccounts)
      .where(eq(riotAccounts.id, account.id));
    expect(unlinked).toMatchObject({ memberId: null, linkedAt: null });
    const [storedMember] = await db
      .select()
      .from(members)
      .where(eq(members.id, memberId));
    expect(storedMember).toMatchObject({ name: "김수정", birthYear: null });
    const logs = await db.select().from(auditLogs);
    expect(logs).toHaveLength(5); // One grant and four business changes.
    expect(JSON.stringify(logs)).not.toContain(administrator.issued.key);
    const [credential] = await db.select().from(adminCredentials);
    expect(JSON.stringify(logs)).not.toContain(credential.keyHash);
  });

  it("retains the original actor name snapshot after that administrator changes their name", async () => {
    const administrator = await assignedAdministrator();
    mocks.token = administrator.token;
    await updateMember(administrator.memberId, "김새관리자", 1991);
    await createMember("박모임원", null);
    expect(await event("member.updated")).toMatchObject({
      actorName: "김관리자",
    });
    expect(await event("member.created")).toMatchObject({
      actorName: "김새관리자",
    });
  });

  it("records owner date correction, exclusion and restorations without losing original replay data", async () => {
    const { gameId } = await ingest();
    const corrected = "2026-10-03";
    expect(await setGamePlayedAt(gameId, corrected)).toBe(true);
    expect(await event("game.date_updated")).toMatchObject({
      actorRole: "owner",
      actorMemberId: null,
      actorCredentialId: null,
      actorName: "서비스 오너",
      targetType: "game",
      targetId: gameId,
      before: { playedAtOverride: null },
      after: { playedAtOverride: corrected },
    });
    expect(await setGamePlayedAt(gameId, null)).toBe(true);
    expect(await event("game.date_restored")).toMatchObject({
      before: { playedAtOverride: corrected },
      after: { playedAtOverride: null },
    });
    expect(await setGameExcluded(gameId, true)).toBe(true);
    const [excluded] = await db
      .select()
      .from(games)
      .where(eq(games.id, gameId));
    expect(await event("game.excluded")).toMatchObject({
      actorRole: "owner",
      before: { excludedAt: null },
      after: { excludedAt: excluded.excludedAt!.toISOString() },
    });
    expect(await setGameExcluded(gameId, false)).toBe(true);
    expect(await event("game.restored")).toMatchObject({
      before: { excludedAt: excluded.excludedAt!.toISOString() },
      after: { excludedAt: null },
    });
    const [restored] = await db
      .select()
      .from(games)
      .where(eq(games.id, gameId));
    expect(restored).toMatchObject({
      playedAt: "2026-10-01",
      playedAtSource: "file_mtime",
      playedAtOverride: null,
      excludedAt: null,
    });
  });

  it.each(["create", "update", "link", "unlink", "date", "exclude"] as const)(
    "rolls back a %s business change when its audit insert fails",
    async (operation) => {
      const administrator = await assignedAdministrator();
      mocks.token = administrator.token;
      const memberId = await createMemberFixture("원래 이름", 1988);
      const account = await accountFixture(
        operation === "unlink" ? memberId : null,
      );
      const { gameId } = await ingest();
      const before = await snapshot();
      const changes = {
        create: () => createMember("등록 실패", 1993),
        update: () => updateMember(memberId, "저장 실패", null),
        link: () => linkAccount(account.id, memberId),
        unlink: () => unlinkAccount(account.id),
        date: () => setGamePlayedAt(gameId, "2026-10-04"),
        exclude: () => setGameExcluded(gameId, true),
      };
      await withBrokenAudit(async () => {
        await expect(changes[operation]()).rejects.toThrow();
        expect(await snapshot()).toEqual(before);
      });
    },
  );

  it("blocks every business mutation and stale-actor replay commit after completed revocation, including duplicates", async () => {
    const administrator = await assignedAdministrator();
    const memberId = await createMemberFixture("보호 모임원", 1997);
    const account = await accountFixture();
    const { gameId } = await ingest();
    await revokeAdminCredential(administrator.memberId);
    mocks.token = administrator.token;
    expect(await getSession()).toBeNull();
    const before = await snapshot();
    const mutations = [
      () => createMember("취소된 관리자의 등록", null),
      () => updateMember(memberId, "취소된 수정", null),
      () => linkAccount(account.id, memberId),
      () => unlinkAccount(account.id),
      () => setGamePlayedAt(gameId, "2026-10-05"),
      () => setGameExcluded(gameId, true),
    ];
    for (const mutation of mutations) {
      await expect(mutation()).rejects.toBeInstanceOf(UnauthorizedError);
    }
    for (const bytes of [
      replayBytes(),
      replayBytes({ metadata: { gameVersion: "different-replay" } }),
    ]) {
      await expect(
        ingest(administrator.actor, randomUUID(), bytes),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    }
    expect(await snapshot()).toEqual(before);
  });
});

describe("replay commit audit and authorization", () => {
  it("commits success and duplicate outcomes with the administrator and bound upload IDs", async () => {
    const administrator = await assignedAdministrator();
    mocks.token = administrator.token;
    const uploadId = randomUUID();
    const stored = await ingest(administrator.actor, uploadId);
    expect(stored.duplicate).toBe(false);
    const duplicateUploadId = randomUUID();
    expect(await ingest(administrator.actor, duplicateUploadId)).toEqual({
      gameId: stored.gameId,
      duplicate: true,
    });
    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "replay.processed"));
    expect(logs).toHaveLength(2);
    for (const [requestId, result] of [
      [uploadId, "success"],
      [duplicateUploadId, "duplicate"],
    ]) {
      expect(logs.find((log) => log.requestId === requestId)).toMatchObject({
        actorRole: "admin",
        actorMemberId: administrator.memberId,
        actorCredentialId: administrator.issued.credentialId,
        actorName: "김관리자",
        targetType: "upload",
        targetId: requestId,
        requestId,
        result,
        before: null,
        after: { gameId: stored.gameId },
      });
    }
    const state = await snapshot();
    expect(state.gameRows).toHaveLength(1);
    expect(state.accountRows).toHaveLength(10);
    expect(state.participants).toHaveLength(10);
  });

  it.each([false, true])(
    "rejects a replay response and preserves all business data on audit failure (existing=%s)",
    async (existing) => {
      const administrator = await assignedAdministrator();
      if (existing) await ingest();
      const uploadId = randomUUID();
      const before = await snapshot();
      await withBrokenAudit(async () => {
        await expect(ingest(administrator.actor, uploadId)).rejects.toThrow();
        expect(await snapshot()).toEqual(before);
      });
      const retry = await ingest(administrator.actor, uploadId);
      expect(retry.duplicate).toBe(existing);
      expect(await event("replay.processed")).toMatchObject({
        actorMemberId: administrator.memberId,
        targetId: uploadId,
        requestId: uploadId,
        result: existing ? "duplicate" : "success",
        after: { gameId: retry.gameId },
      });
    },
  );
});
