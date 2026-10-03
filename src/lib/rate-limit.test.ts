import { describe, expect, it } from "vitest";

import {
  checkRateLimit,
  createRateLimitStore,
  MAX_RATE_LIMIT_BUCKETS,
} from "./rate-limit";

describe("rate limit storage", () => {
  it("keeps the limit until expiry and starts a new window at the exact boundary", () => {
    const store = createRateLimitStore();
    expect(checkRateLimit("client", 2, 1000, { store, now: 0 }).ok).toBe(true);
    expect(checkRateLimit("client", 2, 1000, { store, now: 100 }).ok).toBe(
      true,
    );
    expect(checkRateLimit("client", 2, 1000, { store, now: 999 })).toEqual({
      ok: false,
      retryAfterMs: 1,
    });
    expect(checkRateLimit("client", 2, 1000, { store, now: 1000 }).ok).toBe(
      true,
    );
    expect(checkRateLimit("client", 2, 1000, { store, now: 1001 }).ok).toBe(
      true,
    );
    expect(checkRateLimit("client", 2, 1000, { store, now: 1002 })).toEqual({
      ok: false,
      retryAfterMs: 998,
    });
  });

  it("reclaims expired identities without forgetting an active counter", () => {
    const store = createRateLimitStore();
    checkRateLimit("expired", 1, 1000, { store, now: 0 });
    checkRateLimit("active", 1, 2000, { store, now: 0 });

    expect(checkRateLimit("new", 1, 1000, { store, now: 1000 }).ok).toBe(true);
    expect(store.has("expired")).toBe(false);
    expect(store.size).toBe(2);
    expect(checkRateLimit("active", 1, 2000, { store, now: 1000 })).toEqual({
      ok: false,
      retryAfterMs: 1000,
    });
  });

  it("rejects new identities at capacity without evicting active limits", () => {
    const store = createRateLimitStore();
    checkRateLimit("login:global", 1, 2000, { store, now: 0 });
    for (let i = 1; i < MAX_RATE_LIMIT_BUCKETS; i += 1) {
      expect(checkRateLimit(`client:${i}`, 1, 1000, { store, now: 0 }).ok).toBe(
        true,
      );
    }

    expect(checkRateLimit("overflow", 1, 1000, { store, now: 100 })).toEqual({
      ok: false,
      retryAfterMs: 900,
    });
    expect(store.size).toBe(MAX_RATE_LIMIT_BUCKETS);
    expect(
      checkRateLimit("login:global", 1, 2000, { store, now: 100 }).ok,
    ).toBe(false);
    expect(checkRateLimit("client:1", 1, 1000, { store, now: 100 }).ok).toBe(
      false,
    );

    expect(checkRateLimit("overflow", 1, 1000, { store, now: 1000 }).ok).toBe(
      true,
    );
    expect(store.size).toBe(2);
    expect(
      checkRateLimit("login:global", 1, 2000, { store, now: 1000 }).ok,
    ).toBe(false);
  });
});
