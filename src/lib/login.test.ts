import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LoginThrottleLimits } from "./limits";
import {
  attemptLogin,
  THROTTLED_MESSAGE,
  WRONG_PASSWORD_MESSAGE,
} from "./login";
import { checkLoginThrottle } from "./login-throttle";
import { createRateLimitStore } from "./rate-limit";

const PASSWORD = "correct horse battery staple";

// Tiny budgets so tests exhaust them quickly.
const LIMITS: LoginThrottleLimits = {
  perClientAttempts: 3,
  globalAttempts: 5,
  windowMs: 60_000,
};

beforeEach(() => {
  process.env.UPLOAD_PASSWORD = PASSWORD;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkLoginThrottle - forwarded-header rotation (Codex finding #1)", () => {
  it("does not retain globally rejected identities and reclaims earlier windows", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const store = createRateLimitStore();
    for (let i = 0; i < LIMITS.globalAttempts; i += 1) {
      expect(checkLoginThrottle(`allowed-${i}`, LIMITS, store).ok).toBe(true);
    }
    for (let i = 0; i < 10_000; i += 1) {
      expect(checkLoginThrottle(`rejected-${i}`, LIMITS, store).ok).toBe(false);
    }
    expect(store.size).toBe(LIMITS.globalAttempts + 1);

    vi.setSystemTime(LIMITS.windowMs);
    expect(checkLoginThrottle("next-window", LIMITS, store).ok).toBe(true);
    expect(store.size).toBe(2);
    expect(store.has("login:client:allowed-0")).toBe(false);
    for (let i = 1; i < LIMITS.globalAttempts; i += 1) {
      expect(checkLoginThrottle(`new-${i}`, LIMITS, store).ok).toBe(true);
    }
    expect(checkLoginThrottle("next-rejected", LIMITS, store).ok).toBe(false);
  });

  it("blocks after the global limit even when every attempt uses a fresh client hint", () => {
    const store = createRateLimitStore();

    // Simulates an attacker rotating x-forwarded-for: each attempt presents a
    // brand-new hint, so the per-client buckets never fill...
    for (let i = 0; i < LIMITS.globalAttempts; i += 1) {
      expect(checkLoginThrottle(`rotated-ip-${i}`, LIMITS, store).ok).toBe(
        true,
      );
    }
    // ...but the global bucket does, exactly as it would for a stable client.
    const blocked = checkLoginThrottle("rotated-ip-fresh", LIMITS, store);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("matches the blocking behavior of a stable client identity at the global limit", () => {
    // Same budget consumed by ONE stable hint with a per-client limit that
    // never trips: blocking kicks in at the same attempt count as rotation.
    const store = createRateLimitStore();
    const limits = { ...LIMITS, perClientAttempts: 100 };

    for (let i = 0; i < limits.globalAttempts; i += 1) {
      expect(checkLoginThrottle("stable-ip", limits, store).ok).toBe(true);
    }
    expect(checkLoginThrottle("stable-ip", limits, store).ok).toBe(false);
  });

  it("still throttles when no client identity can be derived at all", () => {
    const store = createRateLimitStore();

    for (let i = 0; i < LIMITS.globalAttempts; i += 1) {
      expect(checkLoginThrottle(null, LIMITS, store).ok).toBe(true);
    }
    expect(checkLoginThrottle(null, LIMITS, store).ok).toBe(false);
  });

  it("trips the per-client bucket first for a single noisy client", () => {
    const store = createRateLimitStore();

    for (let i = 0; i < LIMITS.perClientAttempts; i += 1) {
      expect(checkLoginThrottle("one-ip", LIMITS, store).ok).toBe(true);
    }
    // 4th attempt from the same hint: under the global limit, over per-client.
    expect(checkLoginThrottle("one-ip", LIMITS, store).ok).toBe(false);
  });

  it("keeps counting client-blocked attempts against the global budget", () => {
    const store = createRateLimitStore();

    // 5 attempts from one hint: 3 pass, 2 are per-client-blocked — but all 5
    // must consume global budget, so a NEW hint is now globally blocked too.
    for (let i = 0; i < 5; i += 1) {
      checkLoginThrottle("hammering-ip", LIMITS, store);
    }
    expect(checkLoginThrottle("someone-else", LIMITS, store).ok).toBe(false);
  });
});

describe("attemptLogin", () => {
  it("accepts the correct password and rejects a wrong one", async () => {
    const store = createRateLimitStore();
    expect(
      await attemptLogin(PASSWORD, "ip", {
        limits: LIMITS,
        store,
        failedDelayMs: 0,
      }),
    ).toEqual({ ok: true });
    expect(
      await attemptLogin("nope", "ip", {
        limits: LIMITS,
        store,
        failedDelayMs: 0,
      }),
    ).toEqual({ ok: false, error: WRONG_PASSWORD_MESSAGE });
  });

  it("never reaches password verification once over the limit", async () => {
    const store = createRateLimitStore();
    const verify = vi.fn(() => false);

    // Exhaust the global budget with rotating hints (worst case for spoofing).
    for (let i = 0; i < LIMITS.globalAttempts; i += 1) {
      await attemptLogin("guess", `ip-${i}`, {
        limits: LIMITS,
        store,
        verify,
        failedDelayMs: 0,
      });
    }
    expect(verify).toHaveBeenCalledTimes(LIMITS.globalAttempts);

    verify.mockClear();
    const result = await attemptLogin("guess", "ip-next", {
      limits: LIMITS,
      store,
      verify,
      failedDelayMs: 0,
    });
    expect(result).toEqual({ ok: false, error: THROTTLED_MESSAGE });
    expect(verify).not.toHaveBeenCalled();
  });

  it("throttles even the correct password once over the limit", async () => {
    const store = createRateLimitStore();

    for (let i = 0; i < LIMITS.globalAttempts; i += 1) {
      await attemptLogin("wrong", `ip-${i}`, {
        limits: LIMITS,
        store,
        failedDelayMs: 0,
      });
    }
    const result = await attemptLogin(PASSWORD, "ip-final", {
      limits: LIMITS,
      store,
      failedDelayMs: 0,
    });
    expect(result).toEqual({ ok: false, error: THROTTLED_MESSAGE });
  });
});
