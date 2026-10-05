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
import { checkLoginThrottle } from "./login-throttle";
import { trustedClientIp } from "./trusted-client-ip";

const PASSWORD = "correct horse battery staple";
const LIMITS = { perClientAttempts: 3, windowMs: 60_000 };

beforeAll(migrateTestDatabase, 30_000);
beforeEach(async () => {
  await resetTestDatabase();
  vi.stubEnv("UPLOAD_PASSWORD", PASSWORD);
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
    ).toEqual({ ok: true });
    expect(
      await attemptLogin("wrong", "198.51.100.7", { failedDelayMs: 0 }),
    ).toEqual({ ok: false, error: WRONG_PASSWORD_MESSAGE });
  });

  it("never verifies a password after that IP reaches its limit", async () => {
    const verify = vi.fn(() => false);
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
    ).toEqual({ ok: true });
  });
});
