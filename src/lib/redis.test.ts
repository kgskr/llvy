import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructed: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("ioredis", () => ({
  default: class Redis {
    status = "ready";
    connect = mocks.connect;
    disconnect = mocks.disconnect;
    on = mocks.on;
    constructor(url: string, options: unknown) {
      mocks.constructed(url, options);
    }
  },
}));

import { disconnectRedis, getRedisConnection } from "./redis";

beforeEach(() => {
  disconnectRedis();
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue(undefined);
  vi.stubEnv(
    "REDIS_URL",
    "rediss://default:fixture-password@redis.example:6379",
  );
  vi.stubEnv(
    "POSTGRES_URL",
    "postgres://fixture:fixture@database.example/club",
  );
  vi.stubEnv("REDIS_KEY_PREFIX", "fixture");
  vi.stubEnv("VERCEL_ENV", "preview");
});
afterEach(() => {
  disconnectRedis();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Upstash REDIS_URL connection", () => {
  it("shares a TLS connection across concurrent calls with bounded waits", async () => {
    const [one, two] = await Promise.all([
      getRedisConnection(),
      getRedisConnection(),
    ]);
    expect(one?.client).toBe(two?.client);
    expect(mocks.constructed).toHaveBeenCalledTimes(1);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    const options = mocks.constructed.mock.calls[0][1];
    expect(options).toMatchObject({
      tls: { servername: "redis.example" },
      lazyConnect: true,
      connectTimeout: 100,
      commandTimeout: 100,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      autoResendUnfulfilledCommands: false,
    });
    expect(options.tls).not.toHaveProperty("rejectUnauthorized", false);
    expect(options.retryStrategy()).toBeNull();
  });

  it("does not connect when the optional URL is absent", async () => {
    vi.stubEnv("REDIS_URL", "");
    expect(await getRedisConnection()).toBeNull();
    expect(mocks.constructed).not.toHaveBeenCalled();
  });

  it("does not reconnect to the retired provider when REDIS_URL is missing", async () => {
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("VALKEY_URL", "rediss://default:old-password@old.example:6379");
    expect(await getRedisConnection()).toBeNull();
    expect(mocks.constructed).not.toHaveBeenCalled();
  });

  it("uses REDIS_URL and replaces the connection when its endpoint changes", async () => {
    vi.stubEnv("VALKEY_URL", "rediss://default:old-password@old.example:6379");
    const first = await getRedisConnection();
    const replacement =
      "rediss://default:new-password@replacement.upstash.io:6379";
    vi.stubEnv("REDIS_URL", replacement);
    const second = await getRedisConnection();
    expect(second?.client).not.toBe(first?.client);
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.constructed).toHaveBeenLastCalledWith(
      replacement,
      expect.objectContaining({
        tls: { servername: "replacement.upstash.io" },
      }),
    );
    expect(mocks.connect).toHaveBeenCalledTimes(2);
  });

  it.each([
    "redis://default:fixture-password@remote.example:6379",
    "https://remote.example",
    "invalid-fixture-password",
  ])(
    "rejects insecure or malformed remote URLs without logging secrets",
    async (url) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.stubEnv("REDIS_URL", url);
      expect(await getRedisConnection()).toBeNull();
      expect(mocks.constructed).not.toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain("fixture-password");
    },
  );

  it("permits local plaintext tests but rejects plaintext in production", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:16379");
    expect(await getRedisConnection()).not.toBeNull();
    disconnectRedis();
    vi.stubEnv("NODE_ENV", "production");
    expect(await getRedisConnection()).toBeNull();
  });

  it("separates environments and DBs while a DB password rotation retains the namespace", async () => {
    const first = await getRedisConnection();
    vi.stubEnv(
      "POSTGRES_URL",
      "postgres://fixture:new-password@database.example/club",
    );
    expect((await getRedisConnection())?.prefix).toBe(first?.prefix);
    vi.stubEnv(
      "POSTGRES_URL",
      "postgres://fixture:fixture@database.example/other",
    );
    expect((await getRedisConnection())?.prefix).not.toBe(first?.prefix);
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await getRedisConnection())?.prefix).not.toBe(first?.prefix);
  });

  it("falls back after a connection failure and retries only after the cooldown", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let now = 100_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.connect.mockRejectedValueOnce(
      new Error("fixture-password connection failed"),
    );
    expect(await getRedisConnection()).toBeNull();
    expect(await getRedisConnection()).toBeNull();
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    now += 5001;
    expect(await getRedisConnection()).not.toBeNull();
    expect(mocks.connect).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("fixture-password");
  });

  it("bounds readiness even when the driver never finishes connecting", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    mocks.connect.mockImplementationOnce(() => new Promise(() => {}));
    const connecting = getRedisConnection();
    await vi.advanceTimersByTimeAsync(101);
    expect(await connecting).toBeNull();
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
  });
});
