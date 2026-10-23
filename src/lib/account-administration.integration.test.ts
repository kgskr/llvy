import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
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
  adminGrants,
  auditLogs,
  authAccounts,
  authSessions,
  pendingUploads,
} from "@/db/schema";
import {
  client,
  db,
  migrateTestDatabase,
  resetTestDatabase,
} from "@/test/database";
import { createTestSession } from "@/test/auth";
const mocks = vi.hoisted(() => ({
  token: undefined as string | undefined,
  deleteCookie: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => ({ db: (await import("@/test/database")).db }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (mocks.token ? { value: mocks.token } : undefined),
    delete: mocks.deleteCookie,
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error("redirect:" + path);
  },
}));
import {
  AccountIneligibleError,
  GrantConflictError,
  grantAdministrator,
  grantUploader,
  listLoginAccounts,
  revokeAdministrator,
} from "./account-administration";
import { completeDiscordLogin, saveMembership } from "./auth-store";
import { lookupGuildMember } from "./discord";
import {
  assertAdmin,
  assertOwner,
  ForbiddenError,
  getSession,
  UnauthorizedError,
} from "./session";
import { appendAudit, listAuditLogs, withActorTransaction } from "./audit";
import { createPendingUpload, getPendingUpload } from "./pending-upload-store";
import { matchesUploadActor } from "./upload-actor";
import { validatePendingToken } from "./pending-upload";
import { logout } from "@/app/login/actions";

beforeAll(migrateTestDatabase, 30_000);
beforeEach(async () => {
  await resetTestDatabase();
  vi.clearAllMocks();
  mocks.token = (await createTestSession("owner")).token;
  mocks.fetch.mockImplementation(async (url: string) =>
    Response.json({
      user: { id: String(url).split("/").at(-1) },
      pending: false,
    }),
  );
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(() => client.close());
async function snapshot() {
  return Promise.all([
    db.select().from(authAccounts).orderBy(authAccounts.id),
    db.select().from(authSessions).orderBy(authSessions.id),
    db.select().from(adminGrants).orderBy(adminGrants.id),
    db.select().from(auditLogs).orderBy(auditLogs.id),
    db.select().from(pendingUploads).orderBy(pendingUploads.id),
  ]);
}
async function brokenAudit(work: () => Promise<void>) {
  await client.exec(
    `CREATE FUNCTION reject_auth_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER reject_auth_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_auth_audit();`,
  );
  try {
    await work();
  } finally {
    await client.exec(
      "DROP TRIGGER reject_auth_audit ON audit_logs; DROP FUNCTION reject_auth_audit();",
    );
  }
}
describe("independent account grants and current authority", () => {
  it.each(["absent", "pending"] as const)(
    "rejects protected uploader targets before %s membership can retire their authority",
    async (status) => {
      const admin = await createTestSession("admin");
      const other = await createTestSession("admin");
      mocks.token = admin.token;
      mocks.fetch.mockImplementation(async (url: string) =>
        status === "absent"
          ? Response.json({ code: 10007 }, { status: 404 })
          : Response.json({
              user: { id: String(url).split("/").at(-1) },
              pending: true,
            }),
      );
      const before = await snapshot();
      for (const target of [admin, other]) {
        await expect(grantUploader(target.accountId)).rejects.toBeInstanceOf(
          AccountIneligibleError,
        );
      }
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(await snapshot()).toEqual(before);
    },
  );
  it("commits an eligible viewer's confirmed denial during an administrator uploader grant", async () => {
    const admin = await createTestSession("admin");
    const viewer = await createTestSession("viewer");
    mocks.token = admin.token;
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ code: 10007 }, { status: 404 }),
    );
    await expect(grantUploader(viewer.accountId)).rejects.toBeInstanceOf(
      AccountIneligibleError,
    );
    expect(
      (
        await db
          .select()
          .from(authAccounts)
          .where(eq(authAccounts.id, viewer.accountId))
      )[0].status,
    ).toBe("suspended");
    expect(
      (
        await db
          .select()
          .from(authSessions)
          .where(eq(authSessions.id, viewer.sessionId))
      )[0].revokedAt,
    ).not.toBeNull();
    expect(await getSession()).toMatchObject({
      accountId: admin.accountId,
      role: "admin",
    });
    expect(
      (await db.select().from(auditLogs)).filter(
        (row) => row.action === "auth.account_suspended",
      ),
    ).toMatchObject([
      { actorAccountId: admin.accountId, targetId: viewer.accountId },
    ]);
  });
  it("does not mistake a locked operation actor for an unknown membership target", async () => {
    const actor = (await getSession())!;
    const before = await snapshot();
    expect(
      await saveMembership(
        {
          userId: "777777777777777777",
          guildId: "222222222222222222",
          version: 1,
          checkedAt: new Date(),
          status: "absent",
        },
        actor,
      ),
    ).toBe(false);
    expect(await snapshot()).toEqual(before);
  });
  it("commits grant-time denial atomically with owner attribution and grant/session retirement", async () => {
    const actor = (await getSession())!;
    const target = await createTestSession("admin");
    const before = await snapshot();
    await brokenAudit(async () => {
      mocks.fetch.mockResolvedValueOnce(
        Response.json({ code: 10007 }, { status: 404 }),
      );
      await expect(grantAdministrator(target.accountId)).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
    });
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ code: 10007 }, { status: 404 }),
    );
    await expect(grantAdministrator(target.accountId)).rejects.toBeInstanceOf(
      AccountIneligibleError,
    );
    expect(
      (
        await db
          .select()
          .from(authAccounts)
          .where(eq(authAccounts.id, target.accountId))
      )[0].status,
    ).toBe("suspended");
    expect((await db.select().from(adminGrants))[0]).toMatchObject({
      revokedAt: expect.any(Date),
      revokedBy: actor.accountId,
    });
    expect(
      (
        await db
          .select()
          .from(authSessions)
          .where(eq(authSessions.id, target.sessionId))
      )[0].revokedAt,
    ).not.toBeNull();
    expect((await db.select().from(auditLogs))[0]).toMatchObject({
      actorAccountId: actor.accountId,
      action: "auth.account_suspended",
      targetId: target.accountId,
    });
  });
  it("permits only one simultaneous grant and keeps one success audit", async () => {
    const target = await createTestSession("viewer");
    const results = await Promise.allSettled([
      grantAdministrator(target.accountId),
      grantAdministrator(target.accountId),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await db.select().from(adminGrants)).toHaveLength(1);
    expect(
      (await db.select().from(auditLogs)).filter(
        (row) => row.action === "admin.granted",
      ),
    ).toHaveLength(1);
  });
  it("serializes a remembered actor transaction with concurrent revocation", async () => {
    const actor = await createTestSession("admin");
    const [mutation, revocation] = await Promise.allSettled([
      withActorTransaction(actor, (tx) =>
        appendAudit(tx, actor, { action: "game.excluded", targetType: "game" }),
      ),
      revokeAdministrator(actor.accountId),
    ]);
    expect(revocation.status).toBe("fulfilled");
    const events = (
      await db.select().from(auditLogs).orderBy(auditLogs.occurredAt)
    ).map((row) => row.action);
    if (mutation.status === "fulfilled")
      expect(events).toEqual(["game.excluded", "admin.revoked"]);
    else expect(events).toEqual(["admin.revoked"]);
    await expect(
      withActorTransaction(actor, async () => true),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
  it.each(["viewer", "admin"] as const)(
    "blocks %s direct owner operations before provider calls",
    async (role) => {
      mocks.token = (await createTestSession(role)).token;
      const before = await snapshot();
      for (const operation of [
        () => grantAdministrator(randomUUID()),
        () => revokeAdministrator(randomUUID()),
        ...(role === "viewer" ? [() => listLoginAccounts()] : []),
        () => listAuditLogs(),
      ])
        await expect(operation()).rejects.toBeInstanceOf(ForbiddenError);
      expect(await snapshot()).toEqual(before);
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );
  it("immediately elevates an existing session and revokes every old session on removal", async () => {
    const target = await createTestSession("viewer");
    const other = await createTestSession("viewer", {
      userId: target.discordUserId,
    });
    const ownerToken = mocks.token;
    const id = await grantAdministrator(target.accountId);
    mocks.token = target.token;
    expect(await assertAdmin()).toMatchObject({
      adminGrantId: id,
      accountId: target.accountId,
    });
    await expect(assertOwner()).rejects.toBeInstanceOf(ForbiddenError);
    mocks.token = ownerToken;
    expect(await revokeAdministrator(target.accountId)).toBe(true);
    expect(await revokeAdministrator(target.accountId)).toBe(false);
    for (const token of [target.token, other.token]) {
      mocks.token = token;
      expect(await getSession()).toBeNull();
    }
    expect(
      await db
        .select()
        .from(authSessions)
        .where(
          and(
            eq(authSessions.accountId, target.accountId),
            isNull(authSessions.revokedAt),
          ),
        ),
    ).toEqual([]);
  });
  it("enforces unique active grants in both service and database", async () => {
    const target = await createTestSession("viewer");
    await grantAdministrator(target.accountId);
    await expect(grantAdministrator(target.accountId)).rejects.toBeInstanceOf(
      GrantConflictError,
    );
    const owner = await assertOwner();
    await expect(
      db
        .insert(adminGrants)
        .values({ accountId: target.accountId, issuedBy: owner.accountId }),
    ).rejects.toThrow();
    expect(await db.select().from(adminGrants)).toHaveLength(1);
    expect(await db.select().from(auditLogs)).toHaveLength(1);
  });
  it("refuses suspended and current owner targets before contacting Discord", async () => {
    const target = await createTestSession("viewer");
    await db
      .update(authAccounts)
      .set({ status: "suspended" })
      .where(eq(authAccounts.id, target.accountId));
    await expect(grantAdministrator(target.accountId)).rejects.toBeInstanceOf(
      AccountIneligibleError,
    );
    await expect(
      grantAdministrator((await assertOwner()).accountId),
    ).rejects.toBeInstanceOf(AccountIneligibleError);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("keeps role and account search independent of duplicate display names", async () => {
    const one = await createTestSession("viewer", { name: "동명%_ 사용자" });
    const two = await createTestSession("viewer", { name: "동명%_ 사용자" });
    await grantAdministrator(one.accountId);
    const list = await listLoginAccounts("%_", 1, 0);
    expect(list.total).toBe(2);
    expect(list.accounts).toHaveLength(1);
    expect((await listLoginAccounts(two.discordUserId)).accounts).toEqual([
      expect.objectContaining({ id: two.accountId, role: "viewer" }),
    ]);
    expect(JSON.stringify(await listLoginAccounts())).not.toMatch(
      /referenceHash|sessionId|token|keyHash|memberId/,
    );
  });
  it("applies owner changes immediately and rejects a stale mutation actor", async () => {
    const previous = await assertOwner();
    const next = await createTestSession("viewer");
    vi.stubEnv("DISCORD_OWNER_USER_ID", next.discordUserId);
    expect(await getSession()).toMatchObject({ role: "viewer" });
    await expect(
      withActorTransaction(previous, async () => true),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    mocks.token = next.token;
    expect(await assertOwner()).toMatchObject({ accountId: next.accountId });
  });
  it("invalidates sessions when the configured guild or signing secret changes", async () => {
    const target = await createTestSession("admin");
    mocks.token = target.token;
    vi.stubEnv("DISCORD_GUILD_ID", "555555555555555555");
    expect(await getSession()).toBeNull();
    vi.stubEnv("DISCORD_GUILD_ID", "222222222222222222");
    vi.stubEnv(
      "AUTH_SECRET",
      "replacement-independent-secret-more-than-32-bytes",
    );
    expect(await getSession()).toBeNull();
  });
  it("prevents old grant reservations from matching a replacement grant or account", async () => {
    const target = await createTestSession("admin");
    const binding = await createPendingUpload(target.token, target);
    const pending = (await getPendingUpload(binding.uploadId))!;
    expect(matchesUploadActor(pending, target)).toBe(true);
    await revokeAdministrator(target.accountId);
    const newGrant = await grantAdministrator(target.accountId);
    const renewed = await createTestSession("viewer", {
      userId: target.discordUserId,
    });
    mocks.token = renewed.token;
    const current = (await getSession())!;
    expect(current.adminGrantId).toBe(newGrant);
    expect(matchesUploadActor(pending, current)).toBe(false);
    expect(
      matchesUploadActor({ ...pending, actorAccountId: null }, current),
    ).toBe(false);
    expect(
      matchesUploadActor(pending, { ...current, accountId: randomUUID() }),
    ).toBe(false);
    expect(await db.select().from(pendingUploads)).toHaveLength(1);
  });
  it("rejects a remembered actor after session revocation before committing an audit", async () => {
    const actor = await createTestSession("admin");
    await revokeAdministrator(actor.accountId);
    await expect(
      withActorTransaction(actor, async (tx) =>
        appendAudit(tx, actor, { action: "game.excluded", targetType: "game" }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(
      (await db.select().from(auditLogs)).map((row) => row.action),
    ).toEqual(["admin.revoked"]);
  });
});
describe("authentication audit rollback and logout", () => {
  it("retires owner reservations atomically and cannot revive them after rejoining", async () => {
    const owner = (await getSession())!;
    const binding = await createPendingUpload(owner.token, owner);
    const positive = await lookupGuildMember(owner.discordUserId);
    const before = await snapshot();
    await brokenAudit(async () => {
      await expect(
        saveMembership({ ...positive, status: "absent" }),
      ).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
    });
    await saveMembership({ ...positive, status: "absent" });
    const renewed = await completeDiscordLogin(
      { id: owner.discordUserId, username: "owner", displayName: "오너" },
      await lookupGuildMember(owner.discordUserId),
    );
    mocks.token = renewed.token;
    expect(await getSession()).toMatchObject({ role: "owner" });
    const old = (await getPendingUpload(binding.uploadId))!;
    expect(old.state).toBe("failed");
    expect(
      validatePendingToken(old, {
        nonce: binding.nonce,
        pathname: binding.pathname,
      }),
    ).toMatchObject({ ok: false });
    await expect(
      withActorTransaction(owner, async () => true),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
  it.each(["login", "grant", "revoke", "suspend"] as const)(
    "rolls back the whole %s authority change on audit failure",
    async (kind) => {
      const target = await createTestSession(
        kind === "revoke" || kind === "suspend" ? "admin" : "viewer",
      );
      const check = await lookupGuildMember(target.discordUserId);
      const before = await snapshot();
      await brokenAudit(async () => {
        const work =
          kind === "login"
            ? () =>
                completeDiscordLogin(
                  {
                    id: target.discordUserId,
                    username: "changed",
                    displayName: "changed",
                  },
                  check,
                )
            : kind === "grant"
              ? () => grantAdministrator(target.accountId)
              : kind === "revoke"
                ? () => revokeAdministrator(target.accountId)
                : () => saveMembership({ ...check, status: "absent" });
        await expect(work()).rejects.toThrow();
        expect(await snapshot()).toEqual(before);
      });
    },
  );
  it("revokes a logged-out session and audits it without provider access", async () => {
    const target = await createTestSession("admin");
    mocks.token = target.token;
    await expect(logout()).rejects.toThrow("redirect:/login");
    expect(mocks.deleteCookie).toHaveBeenCalledWith("llvy_session");
    expect(await getSession()).toBeNull();
    expect((await db.select().from(auditLogs))[0]).toMatchObject({
      action: "auth.logout",
      actorAccountId: target.accountId,
      actorAdminGrantId: target.adminGrantId,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("still clears the browser cookie when lookup or logout audit fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const target = await createTestSession("admin");
    mocks.token = target.token;
    const spy = vi.spyOn(db, "select").mockImplementationOnce(() => {
      throw new Error("storage unavailable");
    });
    await expect(logout()).rejects.toThrow("redirect:/login");
    expect(mocks.deleteCookie).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    await brokenAudit(async () => {
      await expect(logout()).rejects.toThrow("redirect:/login");
    });
    expect(mocks.deleteCookie).toHaveBeenCalledTimes(2);
    expect(mocks.fetch).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
