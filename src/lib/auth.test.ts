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
const OWNER_PASSWORD = "separate correct horse for administrators";
const SIGNING_SECRET = "independent-server-signing-secret-at-least-32-bytes";
const ROLES = ["viewer", "admin", "owner"] as const;
const MEMBER_ID = randomUUID();
const CREDENTIAL_ID = randomUUID();
function identity(role: SessionRole) {
  return {
    role,
    memberId: role === "admin" ? MEMBER_ID : null,
    credentialId: role === "admin" ? CREDENTIAL_ID : null,
  };
}

beforeEach(() => {
  vi.stubEnv("READ_PASSWORD", PASSWORD);
  vi.stubEnv("OWNER_PASSWORD", OWNER_PASSWORD);
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
  password = role === "owner"
    ? OWNER_PASSWORD
    : role === "viewer"
      ? PASSWORD
      : "",
) {
  const key = hkdfSync(
    "sha256",
    secret,
    JSON.stringify(["llvy-session-hkdf-v4", role, password]),
    "llvy-session-hmac",
    32,
  );
  return `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
}

describe("shared-key roles and configuration", () => {
  it("derives the role from the matching key and rejects other inputs", () => {
    expect(authenticatePassword(PASSWORD)).toBe("viewer");
    expect(authenticatePassword(OWNER_PASSWORD)).toBe("owner");
    for (const input of ["nope", "", PASSWORD + " ", SIGNING_SECRET]) {
      expect(authenticatePassword(input)).toBeNull();
    }
  });

  it.each([
    ["READ_PASSWORD", ""],
    ["READ_PASSWORD", "   "],
    ["OWNER_PASSWORD", ""],
    ["OWNER_PASSWORD", "   "],
    ["OWNER_PASSWORD", PASSWORD],
    ["AUTH_SECRET", ""],
    ["AUTH_SECRET", "x".repeat(31)],
    ["AUTH_SECRET", PASSWORD],
    ["AUTH_SECRET", OWNER_PASSWORD],
  ])(
    "rejects invalid %s configuration without accepting any session",
    async (name, value) => {
      const token = await createSessionToken(identity("admin"));
      vi.stubEnv(name, value);
      expect(() => authenticatePassword(PASSWORD)).toThrow(
        AuthConfigurationError,
      );
      await expect(createSessionToken(identity("admin"))).rejects.toThrow(
        AuthConfigurationError,
      );
      expect(await readSessionToken(token)).toBeNull();
      try {
        authenticatePassword(PASSWORD);
      } catch (error) {
        expect(String(error)).not.toContain(PASSWORD);
        expect(String(error)).not.toContain(OWNER_PASSWORD);
        expect(String(error)).not.toContain(SIGNING_SECRET);
      }
    },
  );

  it("does not accept retired shared keys", () => {
    vi.stubEnv("UPLOAD_PASSWORD", "retired-uploader-key");
    vi.stubEnv("ADMIN_PASSWORD", "retired-admin-key");
    expect(authenticatePassword("retired-uploader-key")).toBeNull();
    expect(authenticatePassword("retired-admin-key")).toBeNull();
  });

  it("rejects missing environment variables", () => {
    for (const name of ["READ_PASSWORD", "OWNER_PASSWORD", "AUTH_SECRET"]) {
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
      const token = await createSessionToken(identity(role));
      expect(await readSessionToken(token)).toEqual({
        ...identity(role),
        issuedAt: expect.any(Number),
      });
      expect(await verifySessionToken(token)).toBe(true);
      for (const secret of [PASSWORD, OWNER_PASSWORD, SIGNING_SECRET]) {
        expect(token).not.toContain(secret);
      }
    },
  );

  it("requires complete administrator identity and forbids it on shared roles", async () => {
    for (const actor of [
      { role: "admin", memberId: null, credentialId: null },
      { role: "admin", memberId: MEMBER_ID, credentialId: "invalid-id" },
      { role: "owner", memberId: MEMBER_ID, credentialId: CREDENTIAL_ID },
      { role: "viewer", memberId: MEMBER_ID, credentialId: null },
    ] as Parameters<typeof createSessionToken>[0][]) {
      await expect(createSessionToken(actor)).rejects.toThrow(
        "Invalid session role",
      );
    }
  });

  it("rejects genuinely signed legacy v3 administrator sessions", async () => {
    const payload = `v3.admin.${Date.now()}.${randomUUID()}`;
    const key = hkdfSync(
      "sha256",
      SIGNING_SECRET,
      JSON.stringify(["llvy-session-hkdf-v3", "admin", OWNER_PASSWORD]),
      "llvy-session-hmac",
      32,
    );
    const token = `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
    expect(await readSessionToken(token)).toBeNull();
  });

  it("issues distinct session identities even within one millisecond", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const first = await createSessionToken("viewer");
    const second = await createSessionToken("viewer");
    expect(first).not.toBe(second);
    expect(await verifySessionToken(first)).toBe(true);
    expect(await verifySessionToken(second)).toBe(true);
  });

  it("rejects role, timestamp, nonce and signature tampering", async () => {
    const token = await createSessionToken(identity("admin"));
    const parts = token.split(".");
    for (const [index, value] of [
      [1, "owner"],
      [2, String(Number(parts[2]) + 1)],
      [3, randomUUID()],
      [4, randomUUID()],
      [5, randomUUID()],
      [6, "A".repeat(43)],
    ] as const) {
      const changed = [...parts];
      changed[index] = value;
      expect(await readSessionToken(changed.join("."))).toBeNull();
    }
  });

  it("rejects an admin signature forged with viewer-known material", async () => {
    const payload = `v4.admin.${Date.now()}.${randomUUID()}.${MEMBER_ID}.${CREDENTIAL_ID}`;
    const token = signPayload(payload, "admin", PASSWORD, PASSWORD);
    expect(await readSessionToken(token)).toBeNull();
  });

  it("rejects signatures derived for a different role", async () => {
    const payload = `v4.admin.${Date.now()}.${randomUUID()}.${MEMBER_ID}.${CREDENTIAL_ID}`;
    expect(await readSessionToken(signPayload(payload, "viewer"))).toBeNull();
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
      `v4.uploader.${now}.${nonce}.-.-`,
      `v4.admin.${now}.not-a-uuid.${MEMBER_ID}.${CREDENTIAL_ID}`,
      `v4.admin.NaN.${nonce}.${MEMBER_ID}.${CREDENTIAL_ID}`,
      `v4.admin.${now}.5.${nonce}.${MEMBER_ID}.${CREDENTIAL_ID}`,
      `v4.admin.-1.${nonce}.${MEMBER_ID}.${CREDENTIAL_ID}`,
      `v4.admin.${now}.${nonce}.-.-`,
      `v4.admin.${now}.${nonce}.${MEMBER_ID}.bad-id`,
      `v4.admin.${now}.${nonce}.${MEMBER_ID}.${CREDENTIAL_ID}.extra`,
      `v4.owner.${now}.${nonce}.${MEMBER_ID}.${CREDENTIAL_ID}`,
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
    const token = await createSessionToken("viewer");
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const alias =
      token.slice(0, -1) + alphabet[alphabet.indexOf(token.at(-1)!) | 1];
    expect(alias).not.toBe(token);
    expect(await readSessionToken(alias)).toBeNull();
  });

  it.each(["viewer", "owner"] as const)(
    "revokes only %s sessions when that key rotates",
    async (role) => {
      const viewer = await createSessionToken("viewer");
      const owner = await createSessionToken("owner");
      const admin = await createSessionToken(identity("admin"));
      vi.stubEnv(
        role === "owner" ? "OWNER_PASSWORD" : "READ_PASSWORD",
        "new-role-key",
      );
      expect(await verifySessionToken(viewer)).toBe(role !== "viewer");
      expect(await verifySessionToken(owner)).toBe(role !== "owner");
      expect(await verifySessionToken(admin)).toBe(true);
      expect(
        await verifySessionToken(await createSessionToken(identity(role))),
      ).toBe(true);
    },
  );

  it("revokes all three roles on signing-secret rotation", async () => {
    const tokens = await Promise.all(
      ROLES.map((role) => createSessionToken(identity(role))),
    );
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
    const token = await createSessionToken(identity("admin"));
    vi.setSystemTime(now + SESSION_MAX_AGE_SECONDS * 1000);
    expect(await verifySessionToken(token)).toBe(true);
    vi.setSystemTime(now + SESSION_MAX_AGE_SECONDS * 1000 + 1);
    expect(await verifySessionToken(token)).toBe(false);
  });

  it("allows at most 60 seconds of future clock tolerance", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now + 60_001);
    const token = await createSessionToken(identity("admin"));
    vi.setSystemTime(now);
    expect(await verifySessionToken(token)).toBe(false);
    vi.setSystemTime(now + 1);
    expect(await verifySessionToken(token)).toBe(true);
  });
});
