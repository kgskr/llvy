import { createHmac, hkdfSync, randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AuthConfigurationError,
  SESSION_MAX_AGE_SECONDS,
  authenticatePassword,
  createSessionToken,
  readSessionToken,
  verifySessionToken,
  type SessionRole,
} from "./auth";

const PASSWORD = "correct horse battery staple for upload";
const ADMIN_PASSWORD = "separate correct horse for administrators";
const SIGNING_SECRET = "independent-server-signing-secret-at-least-32-bytes";
const ROLES = ["uploader", "admin"] as const;

beforeEach(() => {
  vi.stubEnv("UPLOAD_PASSWORD", PASSWORD);
  vi.stubEnv("ADMIN_PASSWORD", ADMIN_PASSWORD);
  vi.stubEnv("AUTH_SECRET", SIGNING_SECRET);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// Construct adversarial tokens independently of the application's Web Crypto.
function signPayload(
  payload: string,
  role: SessionRole = "admin",
  secret = SIGNING_SECRET,
  password = role === "admin" ? ADMIN_PASSWORD : PASSWORD,
) {
  const key = hkdfSync(
    "sha256",
    secret,
    JSON.stringify(["llvy-session-hkdf-v3", role, password]),
    "llvy-session-hmac",
    32,
  );
  return `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
}

describe("shared-key roles and configuration", () => {
  it("derives the role from the matching key and rejects other inputs", () => {
    expect(authenticatePassword(PASSWORD)).toBe("uploader");
    expect(authenticatePassword(ADMIN_PASSWORD)).toBe("admin");
    for (const input of ["nope", "", PASSWORD + " ", SIGNING_SECRET]) {
      expect(authenticatePassword(input)).toBeNull();
    }
  });

  it.each([
    ["UPLOAD_PASSWORD", ""],
    ["UPLOAD_PASSWORD", "   "],
    ["ADMIN_PASSWORD", ""],
    ["ADMIN_PASSWORD", "   "],
    ["ADMIN_PASSWORD", PASSWORD],
    ["AUTH_SECRET", ""],
    ["AUTH_SECRET", "x".repeat(31)],
    ["AUTH_SECRET", PASSWORD],
    ["AUTH_SECRET", ADMIN_PASSWORD],
  ])(
    "rejects invalid %s configuration without accepting any session",
    async (name, value) => {
      const token = await createSessionToken("admin");
      vi.stubEnv(name, value);
      expect(() => authenticatePassword(PASSWORD)).toThrow(
        AuthConfigurationError,
      );
      await expect(createSessionToken("admin")).rejects.toThrow(
        AuthConfigurationError,
      );
      expect(await readSessionToken(token)).toBeNull();
      try {
        authenticatePassword(PASSWORD);
      } catch (error) {
        expect(String(error)).not.toContain(PASSWORD);
        expect(String(error)).not.toContain(ADMIN_PASSWORD);
        expect(String(error)).not.toContain(SIGNING_SECRET);
      }
    },
  );

  it("rejects missing environment variables", () => {
    for (const name of ["UPLOAD_PASSWORD", "ADMIN_PASSWORD", "AUTH_SECRET"]) {
      const original = process.env[name];
      delete process.env[name];
      expect(() => authenticatePassword(PASSWORD)).toThrow(
        AuthConfigurationError,
      );
      process.env[name] = original;
    }
  });
});

describe("role-bound session tokens", () => {
  it.each(ROLES)(
    "round-trips a %s token without exposing credentials",
    async (role) => {
      const token = await createSessionToken(role);
      expect(await readSessionToken(token)).toEqual({
        role,
        issuedAt: expect.any(Number),
      });
      expect(await verifySessionToken(token)).toBe(true);
      for (const secret of [PASSWORD, ADMIN_PASSWORD, SIGNING_SECRET]) {
        expect(token).not.toContain(secret);
      }
    },
  );

  it("issues distinct session identities even within one millisecond", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const first = await createSessionToken("uploader");
    const second = await createSessionToken("uploader");
    expect(first).not.toBe(second);
    expect(await verifySessionToken(first)).toBe(true);
    expect(await verifySessionToken(second)).toBe(true);
  });

  it("rejects role, timestamp, nonce and signature tampering", async () => {
    const token = await createSessionToken("uploader");
    const parts = token.split(".");
    for (const [index, value] of [
      [1, "admin"],
      [2, String(Number(parts[2]) + 1)],
      [3, randomUUID()],
      [4, "A".repeat(43)],
    ] as const) {
      const changed = [...parts];
      changed[index] = value;
      expect(await readSessionToken(changed.join("."))).toBeNull();
    }
  });

  it("rejects an admin signature forged with uploader-known material", async () => {
    const payload = `v3.admin.${Date.now()}.${randomUUID()}`;
    const token = signPayload(payload, "admin", PASSWORD, PASSWORD);
    expect(await readSessionToken(token)).toBeNull();
  });

  it("rejects signatures derived for a different role", async () => {
    const payload = `v3.admin.${Date.now()}.${randomUUID()}`;
    expect(await readSessionToken(signPayload(payload, "uploader"))).toBeNull();
  });

  it.each([
    undefined,
    null,
    "",
    "garbage",
    "v1.123.notbase64$$$",
    "x".repeat(257),
  ])("rejects missing or malformed token %s", async (token) => {
    expect(await readSessionToken(token)).toBeNull();
  });

  it("rejects malformed payloads even when signed correctly", async () => {
    const now = Date.now();
    const nonce = randomUUID();
    for (const payload of [
      `v3.owner.${now}.${nonce}`,
      `v3.admin.${now}.not-a-uuid`,
      `v3.admin.NaN.${nonce}`,
      `v3.admin.${now}.5.${nonce}`,
      `v3.admin.-1.${nonce}`,
      `v3.admin.${now}.${nonce}.extra`,
    ]) {
      expect(await readSessionToken(signPayload(payload))).toBeNull();
    }
  });

  it.each(["v1", "v2"])(
    "rejects genuinely signed legacy %s sessions",
    async (version) => {
      const payload = `${version}.${Date.now()}${version === "v2" ? `.${randomUUID()}` : ""}`;
      const key = hkdfSync(
        "sha256",
        SIGNING_SECRET,
        `llvy-session-hkdf-v1:${PASSWORD}`,
        "llvy-session-hmac",
        32,
      );
      const token = `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
      expect(await readSessionToken(token)).toBeNull();
    },
  );

  it("rejects base64 aliases that would give one session multiple budget identities", async () => {
    const token = await createSessionToken("uploader");
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const alias =
      token.slice(0, -1) + alphabet[alphabet.indexOf(token.at(-1)!) | 1];
    expect(alias).not.toBe(token);
    expect(await readSessionToken(alias)).toBeNull();
  });

  it.each(ROLES)(
    "revokes only %s sessions when that key rotates",
    async (role) => {
      const uploader = await createSessionToken("uploader");
      const admin = await createSessionToken("admin");
      vi.stubEnv(
        role === "admin" ? "ADMIN_PASSWORD" : "UPLOAD_PASSWORD",
        "new-role-key",
      );
      expect(await verifySessionToken(uploader)).toBe(role !== "uploader");
      expect(await verifySessionToken(admin)).toBe(role !== "admin");
      expect(await verifySessionToken(await createSessionToken(role))).toBe(
        true,
      );
    },
  );

  it("revokes both roles on signing-secret rotation", async () => {
    const tokens = await Promise.all(ROLES.map(createSessionToken));
    vi.stubEnv(
      "AUTH_SECRET",
      "second-independent-signing-secret-at-least-32-bytes",
    );
    for (const token of tokens)
      expect(await verifySessionToken(token)).toBe(false);
  });

  it("enforces the 30-day expiration boundary", async () => {
    vi.useFakeTimers();
    const now = Date.parse("2026-01-01T00:00:00Z");
    vi.setSystemTime(now);
    const token = await createSessionToken("admin");
    vi.setSystemTime(now + SESSION_MAX_AGE_SECONDS * 1000);
    expect(await verifySessionToken(token)).toBe(true);
    vi.setSystemTime(now + SESSION_MAX_AGE_SECONDS * 1000 + 1);
    expect(await verifySessionToken(token)).toBe(false);
  });

  it("allows at most 60 seconds of future clock tolerance", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now + 60_001);
    const token = await createSessionToken("admin");
    vi.setSystemTime(now);
    expect(await verifySessionToken(token)).toBe(false);
    vi.setSystemTime(now + 1);
    expect(await verifySessionToken(token)).toBe(true);
  });
});
