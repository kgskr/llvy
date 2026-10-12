import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthConfigurationError, getAuthorityConfig } from "./auth";
import { getBotConfig, getOAuthConfig } from "./discord-config";
beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "independent-test-secret-longer-than-32-bytes");
  vi.stubEnv("DISCORD_GUILD_ID", "222222222222222222");
  vi.stubEnv("DISCORD_OWNER_USER_ID", "111111111111111111");
  vi.stubEnv("DISCORD_CLIENT_ID", "333333333333333333");
  vi.stubEnv("DISCORD_CLIENT_SECRET", "test-oauth-secret");
  vi.stubEnv("DISCORD_BOT_TOKEN", "test-bot-token");
  vi.stubEnv(
    "DISCORD_REDIRECT_URI",
    "http://localhost:3000/api/auth/discord/callback",
  );
  vi.stubEnv("NODE_ENV", "development");
});
afterEach(() => vi.unstubAllEnvs());
it.each([
  "http://outside.invalid/api/auth/discord/callback",
  "https://user:password@app.invalid/api/auth/discord/callback",
  "https://app.invalid/api/auth/discord/callback?return=x",
  "https://app.invalid/api/auth/discord/callback#hash",
  "https://app.invalid/other",
  "invalid",
])("rejects an unsafe explicit callback %s", (value) => {
  vi.stubEnv("DISCORD_REDIRECT_URI", value);
  expect(getOAuthConfig).toThrow(AuthConfigurationError);
});
it("allows explicit development localhost but requires production HTTPS", () => {
  expect(getOAuthConfig().origin).toBe("http://localhost:3000");
  vi.stubEnv("NODE_ENV", "production");
  expect(getOAuthConfig).toThrow(AuthConfigurationError);
  vi.stubEnv(
    "DISCORD_REDIRECT_URI",
    "https://llvy.example/api/auth/discord/callback",
  );
  expect(getOAuthConfig().origin).toBe("https://llvy.example");
});
it("keeps local authority independent of invalid provider configuration", () => {
  vi.stubEnv("DISCORD_BOT_TOKEN", "bad\r\nheader");
  vi.stubEnv("DISCORD_CLIENT_SECRET", "");
  expect(getBotConfig).toThrow(AuthConfigurationError);
  expect(getOAuthConfig).toThrow(AuthConfigurationError);
  expect(getAuthorityConfig().guildId).toBe("222222222222222222");
});
