import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionToken, verifyPassword, verifySessionToken } from "./auth";

const PASSWORD = "correct horse battery staple";

beforeEach(() => {
  vi.stubEnv("UPLOAD_PASSWORD", PASSWORD);
  vi.stubEnv("AUTH_SECRET", "");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("verifyPassword", () => {
  it("accepts the correct password", () => {
    expect(verifyPassword(PASSWORD)).toBe(true);
  });

  it("rejects a wrong or empty password", () => {
    expect(verifyPassword("nope")).toBe(false);
    expect(verifyPassword("")).toBe(false);
    expect(verifyPassword(PASSWORD + " ")).toBe(false);
  });
});

describe("session tokens", () => {
  it("round-trips a freshly created token", async () => {
    const token = await createSessionToken();
    expect(await verifySessionToken(token)).toBe(true);
  });

  it("rejects missing or malformed tokens", async () => {
    expect(await verifySessionToken(undefined)).toBe(false);
    expect(await verifySessionToken("")).toBe(false);
    expect(await verifySessionToken("garbage")).toBe(false);
    expect(await verifySessionToken("v1.123.notbase64$$$")).toBe(false);
  });

  it("rejects a tampered payload", async () => {
    const token = await createSessionToken();
    const [, sig] = [
      token.slice(0, token.lastIndexOf(".")),
      token.slice(token.lastIndexOf(".") + 1),
    ];
    expect(await verifySessionToken(`v1.9999999999999.${sig}`)).toBe(false);
  });

  it("rejects a token signed with a different password", async () => {
    const token = await createSessionToken();
    process.env.UPLOAD_PASSWORD = "a different password";
    expect(await verifySessionToken(token)).toBe(false);
  });

  it("revokes sessions on password rotation with a dedicated signing secret", async () => {
    vi.stubEnv("AUTH_SECRET", "dedicated-signing-secret-for-test");
    const token = await createSessionToken();
    expect(await verifySessionToken(token)).toBe(true);
    vi.stubEnv("UPLOAD_PASSWORD", "new-shared-password");
    expect(await verifySessionToken(token)).toBe(false);
    expect(await verifySessionToken(await createSessionToken())).toBe(true);
  });

  it("revokes sessions on signing-secret rotation", async () => {
    vi.stubEnv("AUTH_SECRET", "first-signing-secret");
    const token = await createSessionToken();
    vi.stubEnv("AUTH_SECRET", "second-signing-secret");
    expect(await verifySessionToken(token)).toBe(false);
  });

  it("rejects an expired but validly-signed token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
    const token = await createSessionToken();
    vi.setSystemTime(new Date("2020-03-01T00:00:00Z")); // ~60 days later
    expect(await verifySessionToken(token)).toBe(false);
  });

  it("accepts a validly-signed token within the max age", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
    const token = await createSessionToken();
    vi.setSystemTime(new Date("2020-01-02T00:00:00Z")); // 1 day later
    expect(await verifySessionToken(token)).toBe(true);
  });
});
