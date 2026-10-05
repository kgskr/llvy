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
  client,
  db,
  migrateTestDatabase,
  resetTestDatabase,
} from "@/test/database";

const mocks = vi.hoisted(() => ({
  token: undefined as string | undefined,
  setCookie: vi.fn(),
  deleteCookie: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => ({ db: (await import("@/test/database")).db }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (mocks.token ? { value: mocks.token } : undefined),
    set: mocks.setCookie,
    delete: mocks.deleteCookie,
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (destination: string) => {
    throw new Error(`redirect:${destination}`);
  },
}));

import { adminCredentials, auditLogs, members } from "@/db/schema";
import { createSessionToken, readSessionToken, type Actor } from "./auth";
import {
  authenticateAccessKey,
  CredentialConflictError,
  findActiveAdmin,
  grantAdminCredential,
  hashAccessKey,
  listAdminAssignments,
  MemberNotFoundError,
  revokeAdminCredential,
} from "./admin-credentials";
import {
  appendAudit,
  listAuditLogs,
  recordAudit,
  withActorTransaction,
} from "./audit";
import {
  assertAdmin,
  assertOwner,
  ForbiddenError,
  getSession,
  UnauthorizedError,
} from "./session";
import { logout } from "@/app/login/actions";

const OWNER_KEY = "test-owner-private-key";
const VIEWER_KEY = "test-viewer-shared-key";

beforeAll(migrateTestDatabase, 30_000);
beforeEach(async () => {
  vi.clearAllMocks();
  await resetTestDatabase();
  vi.stubEnv("READ_PASSWORD", VIEWER_KEY);
  vi.stubEnv("OWNER_PASSWORD", OWNER_KEY);
  vi.stubEnv("AUTH_SECRET", "independent-signing-secret-at-least-32-bytes");
  mocks.token = await createSessionToken("owner");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => client.close());

async function member(name = "김길수") {
  const [row] = await db
    .insert(members)
    .values({ name, birthYear: 1990 })
    .returning();
  return row;
}

async function assignedAdmin() {
  const row = await member();
  const issued = await grantAdminCredential(row.id);
  const actor = (await authenticateAccessKey(issued.key))!;
  return { row, issued, actor, token: await createSessionToken(actor) };
}

async function withBrokenAudit(work: () => Promise<void>) {
  await client.exec(`
    CREATE FUNCTION reject_test_audit() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'test audit insertion failed'; END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER reject_test_audit BEFORE INSERT ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION reject_test_audit();
  `);
  try {
    await work();
  } finally {
    await client.exec(
      "DROP TRIGGER reject_test_audit ON audit_logs; DROP FUNCTION reject_test_audit();",
    );
  }
}

describe("owner-managed administrator credentials", () => {
  it("issues one random key and persists only its SHA-256 hash and grant audit", async () => {
    const row = await member();
    const issued = await grantAdminCredential(row.id);
    expect(issued.key).toMatch(/^[A-Za-z0-9]{16}$/);
    for (const category of [/[A-Z]/, /[a-z]/, /[0-9]/])
      expect(issued.key).toMatch(category);
    const [stored] = await db.select().from(adminCredentials);
    expect(stored).toMatchObject({
      id: issued.credentialId,
      memberId: row.id,
      keyHash: hashAccessKey(issued.key),
      revokedAt: null,
    });
    expect(stored.keyHash).toMatch(/^[0-9a-f]{64}$/);
    const assignments = await listAdminAssignments();
    expect(assignments).toEqual([
      {
        memberId: row.id,
        credentialId: issued.credentialId,
        issuedAt: expect.any(Date),
      },
    ]);
    const [audit] = await listAuditLogs();
    expect(audit).toMatchObject({
      actorRole: "owner",
      actorName: "서비스 오너",
      action: "admin.granted",
      targetId: row.id,
      result: "success",
      after: { administrator: true },
    });
    for (const data of [stored, assignments, audit]) {
      expect(JSON.stringify(data)).not.toContain(issued.key);
    }
    expect(JSON.stringify(audit)).not.toContain(stored.keyHash);
    expect(JSON.stringify(audit)).not.toContain(mocks.token);
    await expect(grantAdminCredential(row.id)).rejects.toBeInstanceOf(
      CredentialConflictError,
    );
    expect(await db.select().from(adminCredentials)).toHaveLength(1);
    expect(await listAuditLogs()).toHaveLength(1);
  });

  it("keeps a single active issuance when callers overlap", async () => {
    const row = await member();
    // PGlite serializes one connection: this tests overlapping callers and the
    // conflict branch, not live PostgreSQL multi-connection lock contention.
    const results = await Promise.allSettled([
      grantAdminCredential(row.id),
      grantAdminCredential(row.id),
      grantAdminCredential(row.id),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await db.select().from(adminCredentials)).toHaveLength(1);
    expect(await listAuditLogs()).toHaveLength(1);
  });

  it("enforces one active credential and unique, well-formed hashes in the DB", async () => {
    const row = await member();
    const issued = await grantAdminCredential(row.id);
    await expect(
      db.insert(adminCredentials).values({
        memberId: row.id,
        keyHash: hashAccessKey("another-generated-key"),
      }),
    ).rejects.toThrow();
    const other = await member("이영희");
    await expect(
      db
        .insert(adminCredentials)
        .values({ memberId: other.id, keyHash: hashAccessKey(issued.key) }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(adminCredentials)
        .values({ memberId: other.id, keyHash: issued.key }),
    ).rejects.toThrow();
    expect(await db.select().from(adminCredentials)).toHaveLength(1);
  });

  it("revokes the key and active session immediately and never revives either on regrant", async () => {
    const { row, issued, actor, token } = await assignedAdmin();
    mocks.token = token;
    expect(await assertAdmin()).toMatchObject(actor);
    mocks.token = await createSessionToken("owner");
    expect(await revokeAdminCredential(row.id)).toBe(true);
    expect(await revokeAdminCredential(row.id)).toBe(false);
    expect(await authenticateAccessKey(issued.key)).toBeNull();
    expect(await findActiveAdmin(issued.credentialId, row.id)).toBeNull();
    mocks.token = token;
    // The signature remains authentic, but the current DB authority is gone.
    expect(await readSessionToken(token)).not.toBeNull();
    expect(await getSession()).toBeNull();
    await expect(assertAdmin()).rejects.toBeInstanceOf(UnauthorizedError);
    mocks.token = await createSessionToken("owner");
    const next = await grantAdminCredential(row.id);
    expect(next.key).not.toBe(issued.key);
    expect(next.credentialId).not.toBe(issued.credentialId);
    expect(await authenticateAccessKey(issued.key)).toBeNull();
    mocks.token = token;
    expect(await getSession()).toBeNull();
    const fresh = (await authenticateAccessKey(next.key))!;
    mocks.token = await createSessionToken(fresh);
    expect(await assertAdmin()).toMatchObject(fresh);
  });

  it("does not authenticate a credential against another member ID", async () => {
    const { row, issued } = await assignedAdmin();
    const other = await member("이영희");
    expect(await findActiveAdmin(issued.credentialId, other.id)).toBeNull();
    mocks.token = await createSessionToken({
      role: "admin",
      memberId: other.id,
      credentialId: issued.credentialId,
    });
    expect(await getSession()).toBeNull();
    expect(await findActiveAdmin(issued.credentialId, row.id)).not.toBeNull();
  });

  it.each(["viewer", "admin"] as const)(
    "blocks %s from issuance, revocation, assignment and audit queries",
    async (role) => {
      const { row, token } = await assignedAdmin();
      mocks.token =
        role === "admin" ? token : await createSessionToken("viewer");
      await expect(assertOwner()).rejects.toBeInstanceOf(ForbiddenError);
      for (const operation of [
        () => grantAdminCredential(row.id),
        () => revokeAdminCredential(row.id),
        listAdminAssignments,
        listAuditLogs,
      ]) {
        await expect(operation()).rejects.toBeInstanceOf(ForbiddenError);
      }
      expect(await db.select().from(adminCredentials)).toHaveLength(1);
      expect(await db.select().from(auditLogs)).toHaveLength(1);
    },
  );

  it("rejects unauthenticated service calls and missing member targets", async () => {
    const row = await member();
    mocks.token = undefined;
    await expect(grantAdminCredential(row.id)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(listAuditLogs()).rejects.toBeInstanceOf(UnauthorizedError);
    mocks.token = await createSessionToken("owner");
    for (const id of [randomUUID(), "not-a-uuid"]) {
      await expect(grantAdminCredential(id)).rejects.toBeInstanceOf(
        MemberNotFoundError,
      );
      await expect(revokeAdminCredential(id)).rejects.toBeInstanceOf(
        MemberNotFoundError,
      );
    }
    expect(await db.select().from(adminCredentials)).toEqual([]);
    expect(await listAuditLogs()).toEqual([]);
  });
});

describe("transactional, attributed audit", () => {
  it("clears the login cookie even when current administrator lookup fails", async () => {
    const { token } = await assignedAdmin();
    mocks.token = token;
    const lookup = vi.spyOn(db, "select").mockImplementationOnce(() => {
      throw new Error("test unavailable credential database");
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(logout()).rejects.toThrow("redirect:/login");
      expect(mocks.deleteCookie).toHaveBeenCalledExactlyOnceWith(
        "llvy_session",
      );
      expect(errorLog).toHaveBeenCalled();
    } finally {
      lookup.mockRestore();
      errorLog.mockRestore();
    }
    expect(
      (await db.select().from(auditLogs)).some(
        (event) => event.action === "auth.logout",
      ),
    ).toBe(false);
  });

  it.each(["viewer", "admin", "owner"] as const)(
    "records %s logout with the verified actor",
    async (role) => {
      const { actor, token } = await assignedAdmin();
      mocks.token = role === "admin" ? token : await createSessionToken(role);
      await expect(logout()).rejects.toThrow("redirect:/login");
      expect(mocks.deleteCookie).toHaveBeenCalledExactlyOnceWith(
        "llvy_session",
      );
      const [record] = (await db.select().from(auditLogs)).filter(
        (entry) => entry.action === "auth.logout",
      );
      expect(record).toMatchObject({
        actorRole: role,
        actorMemberId: role === "admin" ? actor.memberId : null,
        actorCredentialId: role === "admin" ? actor.credentialId : null,
        result: "success",
      });
      expect(JSON.stringify(record)).not.toContain(mocks.token);
    },
  );

  it("rolls back issuance and revocation when their success audit cannot be stored", async () => {
    const row = await member();
    await withBrokenAudit(async () => {
      await expect(grantAdminCredential(row.id)).rejects.toThrow();
      expect(await db.select().from(adminCredentials)).toEqual([]);
    });
    const issued = await grantAdminCredential(row.id);
    await withBrokenAudit(async () => {
      await expect(revokeAdminCredential(row.id)).rejects.toThrow();
      expect(await authenticateAccessKey(issued.key)).not.toBeNull();
      expect(await db.select().from(auditLogs)).toHaveLength(1);
    });
  });

  it("rolls back a business change when its audit insert fails", async () => {
    const { row, actor } = await assignedAdmin();
    await withBrokenAudit(async () => {
      await expect(
        withActorTransaction(actor, async (tx) => {
          await tx
            .update(members)
            .set({ name: "바뀐 이름" })
            .where(eq(members.id, row.id));
          await appendAudit(tx, actor, {
            action: "member.updated",
            targetType: "member",
            targetId: row.id,
            before: { name: row.name },
            after: { name: "바뀐 이름" },
          });
        }),
      ).rejects.toThrow();
      expect((await db.select().from(members))[0].name).toBe(row.name);
      expect(await db.select().from(auditLogs)).toHaveLength(1);
    });
  });

  it("rechecks a revoked actor inside a transaction before invoking mutation work", async () => {
    const { row, actor } = await assignedAdmin();
    await revokeAdminCredential(row.id);
    const work = vi.fn(async () => {});
    await expect(withActorTransaction(actor, work)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(work).not.toHaveBeenCalled();
    await expect(
      withActorTransaction(
        {
          role: "viewer",
          memberId: null,
          credentialId: null,
          name: "일반 사용자",
        },
        work,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(work).not.toHaveBeenCalled();
  });

  it("preserves the actor name snapshot and discards non-allowlisted changes", async () => {
    const { row, actor, issued, token } = await assignedAdmin();
    const changes = {
      name: row.name,
      password: issued.key,
      keyHash: hashAccessKey(issued.key),
      cookie: token,
      nested: { secret: OWNER_KEY },
    };
    const requestId = randomUUID();
    await recordAudit(actor as Actor, {
      action: "member.updated",
      targetType: "member",
      targetId: row.id,
      after: changes,
      requestId,
    });
    await db
      .update(members)
      .set({ name: "변경된 모임원" })
      .where(eq(members.id, row.id));
    const [record] = (await db.select().from(auditLogs)).filter(
      (entry) => entry.requestId === requestId,
    );
    expect(record).toMatchObject({
      actorMemberId: row.id,
      actorCredentialId: actor.credentialId,
      actorName: row.name,
      after: { name: row.name },
    });
    for (const secret of [
      issued.key,
      hashAccessKey(issued.key),
      token,
      OWNER_KEY,
    ])
      expect(JSON.stringify(record)).not.toContain(secret);
  });
});
