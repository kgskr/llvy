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

import { allowAuthenticationRequest, recordLoginFailure } from "./login";
import { auditLogs } from "@/db/schema";
import { db } from "@/test/database";
import { checkLoginThrottle } from "./login-throttle";
import { trustedClientIp } from "./trusted-client-ip";

const LIMITS = { perClientAttempts: 3, windowMs: 60_000 };

beforeAll(migrateTestDatabase, 30_000);
beforeEach(async () => {
  await resetTestDatabase();
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

describe("authentication request and audit budgets", () => {
  it("requires a trusted client before creating any global budget", async () => {
    expect(await allowAuthenticationRequest(null)).toBe(false);
    expect(await allowAuthenticationRequest("198.51.100.7")).toBe(true);
  });
  it("bounds audit failures by client and minute without storing IPs or secrets", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = Date.now();
    try {
      for (let i = 0; i < 5; i++)
        await recordLoginFailure("198.51.100.7", "throttled");
      await recordLoginFailure("203.0.113.9", "membership");
      await recordLoginFailure(null, "invalid_attempt");
      let logs = await db.select().from(auditLogs);
      expect(logs).toHaveLength(3);
      expect(
        logs.every((row) => row.actorRole === null && row.result === "failure"),
      ).toBe(true);
      expect(JSON.stringify(logs)).not.toMatch(
        /198.51.100.7|203.0.113.9|test-bot-token/,
      );
      vi.setSystemTime(now + 60_001);
      await recordLoginFailure("198.51.100.7", "throttled");
      logs = await db.select().from(auditLogs);
      expect(logs).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });
});
