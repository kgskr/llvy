import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ownerActor } from "@/test/actor";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ headers: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));

import { checkCsrf, csrf } from "./browser";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AUTH_SECRET", "independent-test-secret-longer-than-32-bytes");
  vi.stubEnv("DISCORD_GUILD_ID", "222222222222222222");
  vi.stubEnv("DISCORD_OWNER_USER_ID", "111111111111111111");
  vi.stubEnv(
    "DISCORD_REDIRECT_URI",
    "https://llvy.example/api/auth/discord/callback",
  );
  mocks.headers.mockResolvedValue(
    new Headers({
      origin: "https://www.llvy.example",
      host: "www.llvy.example",
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

it.each(["connect:request-id", "devices"])(
  "accepts same-origin %s on www independently of the OAuth callback",
  async (action) => {
    await expect(
      checkCsrf(ownerActor, action, csrf(ownerActor, action)),
    ).resolves.toBeUndefined();
  },
);

it.each([
  { host: "www.llvy.example" },
  { origin: "https://www.llvy.example" },
  { origin: "null", host: "www.llvy.example" },
  { origin: "https://evil.example", host: "www.llvy.example" },
  { origin: "https://llvy.example", host: "www.llvy.example" },
  { origin: "https://www.llvy.example:8443", host: "www.llvy.example" },
  { origin: "http://www.llvy.example", host: "www.llvy.example" },
  { origin: "https://www.llvy.example/path", host: "www.llvy.example" },
  { origin: "https://user@www.llvy.example", host: "www.llvy.example" },
  { origin: "https://www.llvy.example?x=1", host: "www.llvy.example" },
  { origin: "https://www.llvy.example#x", host: "www.llvy.example" },
  { origin: "not a URL", host: "www.llvy.example" },
  {
    origin: "https://evil.example",
    host: "www.llvy.example",
    "x-forwarded-host": "evil.example",
  },
])("rejects invalid request origin %j", async (input) => {
  const requestHeaders = new Headers();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) requestHeaders.set(key, value);
  }
  mocks.headers.mockResolvedValue(requestHeaders);
  await expect(
    checkCsrf(ownerActor, "devices", csrf(ownerActor, "devices")),
  ).rejects.toMatchObject({ code: "forbidden", status: 403 });
});

it.each([
  null,
  "",
  "a".repeat(64),
  "가".repeat(64),
  "0".repeat(63),
  new File(["x"], "csrf"),
])(
  "rejects forged or malformed CSRF values without a length exception",
  async (value) => {
    await expect(checkCsrf(ownerActor, "devices", value)).rejects.toMatchObject(
      { code: "forbidden", status: 403 },
    );
  },
);

it("rejects tokens issued for another session or action", async () => {
  for (const value of [
    csrf({ ...ownerActor, sessionId: "other-session" }, "devices"),
    csrf(ownerActor, "connect:other-request"),
  ]) {
    await expect(checkCsrf(ownerActor, "devices", value)).rejects.toMatchObject(
      { code: "forbidden", status: 403 },
    );
  }
});

it.each(["localhost:3000", "127.0.0.1:3000", "[::1]:3000"])(
  "allows development loopback HTTP only, including exact port: %s",
  async (host) => {
    mocks.headers.mockResolvedValue(
      new Headers({ origin: `http://${host}`, host }),
    );
    const value = csrf(ownerActor, "devices");
    await expect(checkCsrf(ownerActor, "devices", value)).rejects.toMatchObject(
      { code: "forbidden" },
    );
    vi.stubEnv("NODE_ENV", "development");
    await expect(
      checkCsrf(ownerActor, "devices", value),
    ).resolves.toBeUndefined();
    mocks.headers.mockResolvedValue(
      new Headers({
        origin: "http://outside.example",
        host: "outside.example",
      }),
    );
    await expect(checkCsrf(ownerActor, "devices", value)).rejects.toMatchObject(
      { code: "forbidden" },
    );
  },
);
