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

import { disconnectValkey, getValkeyConnection } from "./valkey";

beforeEach(() => {
  disconnectValkey();
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue(undefined);
  vi.stubEnv(
    "VALKEY_URL",
    "rediss://default:fixture-password@valkey.example:6379",
  );
  vi.stubEnv(
    "POSTGRES_URL",
    "postgres://fixture:fixture@database.example/club",
  );
  vi.stubEnv("VALKEY_KEY_PREFIX", "fixture");
  vi.stubEnv("VERCEL_ENV", "preview");
});
afterEach(() => {
  disconnectValkey();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Layerbase VALKEY_URL connection", () => {
  it("shares a TLS connection across concurrent calls with bounded waits", async () => {
    const [one, two] = await Promise.all([
      getValkeyConnection(),
      getValkeyConnection(),
    ]);
    expect(one?.client).toBe(two?.client);
    expect(mocks.constructed).toHaveBeenCalledTimes(1);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    const options = mocks.constructed.mock.calls[0][1];
    expect(options).toMatchObject({
      tls: { servername: "valkey.example" },
      lazyConnect: true,
      connectTimeout: 1000,
      commandTimeout: 1000,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      autoResendUnfulfilledCommands: false,
    });
    expect(options.tls).not.toHaveProperty("rejectUnauthorized", false);
    expect(options.retryStrategy()).toBeNull();
  });

  it("does not connect when the optional URL is absent", async () => {
    vi.stubEnv("VALKEY_URL", "");
    expect(await getValkeyConnection()).toBeNull();
    expect(mocks.constructed).not.toHaveBeenCalled();
  });

  it.each([
    "redis://default:fixture-password@remote.example:6379",
    "https://remote.example",
    "invalid-fixture-password",
  ])(
    "rejects insecure or malformed remote URLs without logging secrets",
    async (url) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.stubEnv("VALKEY_URL", url);
      expect(await getValkeyConnection()).toBeNull();
      expect(mocks.constructed).not.toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain("fixture-password");
    },
  );

  it("permits local plaintext tests but rejects plaintext in production", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("VALKEY_URL", "redis://127.0.0.1:16379");
    expect(await getValkeyConnection()).not.toBeNull();
    disconnectValkey();
    vi.stubEnv("NODE_ENV", "production");
    expect(await getValkeyConnection()).toBeNull();
  });

  it("separates environments and DBs while a DB password rotation retains the namespace", async () => {
    const first = await getValkeyConnection();
    vi.stubEnv(
      "POSTGRES_URL",
      "postgres://fixture:new-password@database.example/club",
    );
    expect((await getValkeyConnection())?.prefix).toBe(first?.prefix);
    vi.stubEnv(
      "POSTGRES_URL",
      "postgres://fixture:fixture@database.example/other",
    );
    expect((await getValkeyConnection())?.prefix).not.toBe(first?.prefix);
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await getValkeyConnection())?.prefix).not.toBe(first?.prefix);
  });

  it("falls back after a connection failure and retries only after the cooldown", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let now = 100_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.connect.mockRejectedValueOnce(
      new Error("fixture-password connection failed"),
    );
    expect(await getValkeyConnection()).toBeNull();
    expect(await getValkeyConnection()).toBeNull();
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    now += 5001;
    expect(await getValkeyConnection()).not.toBeNull();
    expect(mocks.connect).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("fixture-password");
  });

  it("bounds readiness even when the driver never finishes connecting", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    mocks.connect.mockImplementationOnce(() => new Promise(() => {}));
    const connecting = getValkeyConnection();
    await vi.advanceTimersByTimeAsync(1001);
    expect(await connecting).toBeNull();
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
  });
});
