import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthConfigurationError,
  createSessionToken,
  getAuthorityConfig,
  isDiscordId,
  randomReference,
  readSessionToken,
  SESSION_MAX_AGE_SECONDS,
} from "./auth";
beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "independent-cookie-test-secret-at-least-32-bytes");
  vi.stubEnv("DISCORD_GUILD_ID", "222222222222222222");
  vi.stubEnv("DISCORD_OWNER_USER_ID", "111111111111111111");
});
afterEach(() => vi.unstubAllEnvs());
describe("reference-only v5 cookies", () => {
  it("contains no authoritative role, profile or game-member identity", async () => {
    const reference = randomReference();
    const token = await createSessionToken(reference);
    expect(await readSessionToken(token)).toEqual({
      reference,
      issuedAt: expect.any(Number),
    });
    expect(token.split(".")).toHaveLength(4);
    expect(token).not.toMatch(/viewer|admin|owner/);
  });
  it("generates independent 256-bit references", () => {
    const refs = new Set(Array.from({ length: 100 }, randomReference));
    expect(refs.size).toBe(100);
    expect([...refs].every((x) => x.length === 43)).toBe(true);
  });
  it.each(["v1", "v2", "v3", "v4"])(
    "rejects legacy %s regardless of its signature",
    async (version) => {
      const token = await createSessionToken(randomReference());
      expect(await readSessionToken(token.replace("v5", version))).toBeNull();
    },
  );
  it("rejects forged timestamps references and signatures", async () => {
    const token = await createSessionToken(randomReference());
    for (let i = 1; i < 4; i++) {
      const parts = token.split(".");
      parts[i] = i === 1 ? String(Number(parts[i]) - 1) : randomReference();
      expect(await readSessionToken(parts.join("."))).toBeNull();
    }
    expect(await readSessionToken(token + ".extra")).toBeNull();
    expect(await readSessionToken("a".repeat(201))).toBeNull();
  });
  it("rejects noncanonical base64 aliases", async () => {
    const token = await createSessionToken(randomReference());
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const parts = token.split(".");
    parts[3] =
      parts[3].slice(0, -1) + alphabet[alphabet.indexOf(parts[3].at(-1)!) + 1];
    expect(await readSessionToken(parts.join("."))).toBeNull();
    await expect(createSessionToken("invalid")).rejects.toThrow();
  });
  it("enforces the absolute expiry and future clock boundary", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1900000000000);
    expect(
      await readSessionToken(
        await createSessionToken(
          randomReference(),
          Date.now() - SESSION_MAX_AGE_SECONDS * 1000,
        ),
      ),
    ).toBeNull();
    expect(
      await readSessionToken(
        await createSessionToken(
          randomReference(),
          Date.now() - SESSION_MAX_AGE_SECONDS * 1000 + 1,
        ),
      ),
    ).not.toBeNull();
    expect(
      await readSessionToken(
        await createSessionToken(randomReference(), Date.now() + 60_000),
      ),
    ).not.toBeNull();
    expect(
      await readSessionToken(
        await createSessionToken(randomReference(), Date.now() + 60_001),
      ),
    ).toBeNull();
    vi.restoreAllMocks();
  });
  it("rotates the signing secret independently of provider credentials and old passwords", async () => {
    const token = await createSessionToken(randomReference());
    vi.stubEnv("DISCORD_BOT_TOKEN", "");
    vi.stubEnv("DISCORD_CLIENT_SECRET", "");
    vi.stubEnv("READ_PASSWORD", "retired");
    vi.stubEnv("OWNER_PASSWORD", "retired");
    expect(await readSessionToken(token)).not.toBeNull();
    vi.stubEnv("AUTH_SECRET", "a-new-independent-cookie-test-secret-32-bytes");
    expect(await readSessionToken(token)).toBeNull();
  });
  it.each(["AUTH_SECRET", "DISCORD_GUILD_ID", "DISCORD_OWNER_USER_ID"])(
    "rejects missing core setting %s",
    (name) => {
      vi.stubEnv(name, "");
      expect(getAuthorityConfig).toThrow(AuthConfigurationError);
    },
  );
  it.each(["", "0", "01", "NaN", "1.1", "18446744073709551616", 123])(
    "rejects malformed Discord ID %s",
    (id) => {
      expect(isDiscordId(id)).toBe(false);
    },
  );
  it("keeps large exact Discord IDs as strings", () => {
    expect(isDiscordId("18446744073709551615")).toBe(true);
    vi.stubEnv("AUTH_SECRET", "짧음");
    expect(getAuthorityConfig).toThrow(AuthConfigurationError);
  });
});
