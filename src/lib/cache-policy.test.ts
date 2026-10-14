import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { CacheBudget } from "./cache-context";
import { CACHE_TTLS, cacheTtl } from "./query-cache";
import {
  cacheMetric,
  cacheServerTiming,
  withCacheMetrics,
} from "./cache-metrics";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe("cache retention and diagnostics", () => {
  it("keeps members and null TTLs exact and bounds every other policy's jitter", () => {
    const random = vi.spyOn(Math, "random");
    for (const factor of [0, 0.5, 1]) {
      random.mockReturnValue(factor);
      for (const policy of Object.keys(
        CACHE_TTLS,
      ) as (keyof typeof CACHE_TTLS)[]) {
        expect(cacheTtl(policy, null)).toBe(30);
        const ttl = cacheTtl(policy, []);
        if (policy === "members") expect(ttl).toBe(86400);
        else {
          expect(ttl).toBeGreaterThanOrEqual(CACHE_TTLS[policy] * 0.9);
          expect(ttl).toBeLessThanOrEqual(CACHE_TTLS[policy] * 1.1);
        }
      }
    }
  });
  it("caps accumulated cache waits independently of database work", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const budget = new CacheBudget();
    const first = budget.run(
      () => new Promise<void>((resolve) => setTimeout(resolve, 100)),
    );
    await vi.advanceTimersByTimeAsync(100);
    await first;
    const rejected = expect(
      budget.run(() => new Promise(() => {})),
    ).rejects.toThrow("Cache budget exhausted");
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    await expect(budget.run(async () => "too late")).rejects.toThrow(
      "Cache budget exhausted",
    );
  });
  it("bounds request diagnostics and keeps separate requests isolated", async () => {
    vi.stubEnv("CACHE_METRICS", "");
    expect(cacheServerTiming()).toBe("");
    await withCacheMetrics(async () => {
      cacheMetric("auth_ms", 2);
      cacheMetric("auth_ms", 3);
      expect(cacheServerTiming()).toBe("auth_ms;dur=5.00");
      await withCacheMetrics(async () => {
        expect(cacheServerTiming()).toBe("");
      });
      for (let i = 0; i < 100; i++) cacheMetric(`fixed_${i}`);
      expect(cacheServerTiming().split(", ").length).toBeLessThanOrEqual(64);
    });
    expect(cacheServerTiming()).toBe("");
  });
});
