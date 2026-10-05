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
  migrateTestDatabase,
  resetTestDatabase,
} from "@/test/database";

vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => ({ db: (await import("@/test/database")).db }));

import {
  attemptLogin,
  THROTTLED_MESSAGE,
  WRONG_PASSWORD_MESSAGE,
} from "./login";
import { auditLogs, adminCredentials, members } from "@/db/schema";
import { db } from "@/test/database";
import { hashAccessKey } from "./admin-credentials";
import { checkLoginThrottle } from "./login-throttle";
import { trustedClientIp } from "./trusted-client-ip";

const PASSWORD = "correct horse battery staple";
const VIEWER = {
  role: "viewer",
  memberId: null,
  credentialId: null,
  name: "일반 사용자",
};
const OWNER = {
  role: "owner",
  memberId: null,
  credentialId: null,
  name: "서비스 오너",
};
const LIMITS = { perClientAttempts: 3, windowMs: 60_000 };

beforeAll(migrateTestDatabase, 30_000);
beforeEach(async () => {
  await resetTestDatabase();
  vi.stubEnv("READ_PASSWORD", PASSWORD);
  vi.stubEnv("OWNER_PASSWORD", "separate-owner-key");
  vi.stubEnv("AUTH_SECRET", "independent-signing-secret-at-least-32-bytes");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => client.close());

describe("trusted login identity", () => {
  it("uses Vercel's normalized IP and ignores spoofed XFF", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.66",
      "x-vercel-forwarded-for": "198.51.100.7",
    });
    expect(
      trustedClientIp(headers, { vercel: "1", nodeEnv: "production" }),
    ).toBe("198.51.100.7");
    expect(
      trustedClientIp(new Headers({ "x-forwarded-for": "203.0.113.66" }), {
        vercel: "1",
        nodeEnv: "production",
      }),
    ).toBeNull();
    expect(
      trustedClientIp(headers, { vercel: undefined, nodeEnv: "production" }),
    ).toBeNull();
  });
});

describe("shared login throttle", () => {
  it("limits one IP across calls without locking out another IP", async () => {
    for (let i = 0; i < LIMITS.perClientAttempts; i += 1) {
      expect(await checkLoginThrottle("198.51.100.7", LIMITS)).toBe(true);
    }
    expect(await checkLoginThrottle("198.51.100.7", LIMITS)).toBe(false);
    expect(await checkLoginThrottle("203.0.113.9", LIMITS)).toBe(true);
  });

  it("rejects missing trusted IP without creating a shared lockout", async () => {
    expect(await checkLoginThrottle(null, LIMITS)).toBe(false);
    expect(await checkLoginThrottle("203.0.113.9", LIMITS)).toBe(true);
  });

  it("rejects concurrent guesses once the atomic shared budget is spent", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        checkLoginThrottle("198.51.100.7", LIMITS),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(LIMITS.perClientAttempts);
  });
});

describe("attemptLogin", () => {
  it("accepts the correct password and rejects a wrong one", async () => {
    expect(
      await attemptLogin(PASSWORD, "198.51.100.7", { failedDelayMs: 0 }),
    ).toEqual({ ok: true, role: "viewer", actor: VIEWER });
    expect(
      await attemptLogin("wrong", "198.51.100.7", { failedDelayMs: 0 }),
    ).toEqual({ ok: false, error: WRONG_PASSWORD_MESSAGE });
  });

  it("identifies individual administrators and records successful and failed authentication without keys", async () => {
    const key = "RandomAdminKey12";
    const [member] = await db
      .insert(members)
      .values({ name: "김길수", birthYear: 1990 })
      .returning();
    const [credential] = await db
      .insert(adminCredentials)
      .values({ memberId: member.id, keyHash: hashAccessKey(key) })
      .returning();
    const actor = {
      role: "admin",
      memberId: member.id,
      credentialId: credential.id,
      name: member.name,
    };
    expect(
      await attemptLogin(key, "198.51.100.7", { failedDelayMs: 0 }),
    ).toEqual({ ok: true, role: "admin", actor });
    expect(
      await attemptLogin("wrong", "198.51.100.7", { failedDelayMs: 0 }),
    ).toEqual({ ok: false, error: WRONG_PASSWORD_MESSAGE });
    const records = await db.select().from(auditLogs);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      action: "auth.login",
      result: "success",
      actorRole: "admin",
      actorMemberId: member.id,
      actorCredentialId: credential.id,
      actorName: member.name,
    });
    expect(records[1]).toMatchObject({
      action: "auth.login",
      result: "failure",
      actorRole: null,
      after: { reason: "invalid_key" },
    });
    for (const secret of [key, credential.keyHash, process.env.AUTH_SECRET]) {
      expect(JSON.stringify(records)).not.toContain(secret);
    }
  });

  it("rejects oversized inputs before verification with the same wrong-key response", async () => {
    const verify = vi.fn(async () => null);
    for (const value of ["", "x".repeat(513)]) {
      expect(
        await attemptLogin(value, "198.51.100.7", { verify, failedDelayMs: 0 }),
      ).toEqual({ ok: false, error: WRONG_PASSWORD_MESSAGE });
    }
    expect(verify).not.toHaveBeenCalled();
  });

  it("never verifies a password after that IP reaches its limit", async () => {
    const verify = vi.fn(async () => null);
    for (let i = 0; i < LIMITS.perClientAttempts; i += 1) {
      await attemptLogin("guess", "198.51.100.7", {
        limits: LIMITS,
        verify,
        failedDelayMs: 0,
      });
    }
    verify.mockClear();
    expect(
      await attemptLogin("guess", "198.51.100.7", {
        limits: LIMITS,
        verify,
        failedDelayMs: 0,
      }),
    ).toEqual({ ok: false, error: THROTTLED_MESSAGE });
    expect(verify).not.toHaveBeenCalled();

    expect(
      await attemptLogin(PASSWORD, "203.0.113.9", {
        limits: LIMITS,
        failedDelayMs: 0,
      }),
    ).toEqual({ ok: true, role: "viewer", actor: VIEWER });
  });

  it("records throttled failures once per client and minute without verifying rejected keys", async () => {
    const verify = vi.fn(async () => null);
    const throttle = vi.fn(async () => false);
    const now = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect(
          await attemptLogin("rejected-secret", "198.51.100.7", {
            verify,
            throttle,
          }),
        ).toEqual({ ok: false, error: THROTTLED_MESSAGE });
      }
      await attemptLogin("rejected-secret", "203.0.113.9", {
        verify,
        throttle,
      });
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await attemptLogin("rejected-secret", null, { verify, throttle });
      }
      expect(verify).not.toHaveBeenCalled();
      let records = await db.select().from(auditLogs);
      expect(records).toHaveLength(3);
      for (const record of records) {
        expect(record).toMatchObject({
          actorRole: null,
          action: "auth.login",
          result: "failure",
          after: { reason: "throttled" },
        });
      }
      expect(JSON.stringify(records)).not.toContain("rejected-secret");
      expect(JSON.stringify(records)).not.toContain("198.51.100.7");
      vi.setSystemTime(now + 60_001);
      await attemptLogin("rejected-secret", "198.51.100.7", {
        verify,
        throttle,
      });
      records = await db.select().from(auditLogs);
      expect(records).toHaveLength(4);
      expect(verify).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses one trusted-IP budget for successful logins with either role", async () => {
    for (const [password, role] of [
      [PASSWORD, "viewer"],
      ["separate-owner-key", "owner"],
      [PASSWORD, "viewer"],
    ]) {
      expect(
        await attemptLogin(password, "198.51.100.7", { limits: LIMITS }),
      ).toEqual({ ok: true, role, actor: role === "owner" ? OWNER : VIEWER });
    }
    expect(
      await attemptLogin("separate-owner-key", "198.51.100.7", {
        limits: LIMITS,
      }),
    ).toEqual({ ok: false, error: THROTTLED_MESSAGE });
    expect(
      await attemptLogin("separate-owner-key", "203.0.113.9", {
        limits: LIMITS,
      }),
    ).toEqual({ ok: true, role: "owner", actor: OWNER });
  });
});
