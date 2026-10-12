import "server-only";
import {
  AuthConfigurationError,
  getAuthorityConfig,
  isDiscordId,
} from "@/lib/auth";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || value.length > 2048 || /[\r\n]/.test(value))
    throw new AuthConfigurationError();
  return value;
}
export function getBotConfig() {
  const { guildId } = getAuthorityConfig();
  const clientId = required("DISCORD_CLIENT_ID");
  if (!isDiscordId(clientId)) throw new AuthConfigurationError();
  return { guildId, clientId, botToken: required("DISCORD_BOT_TOKEN") };
}
export function getOAuthConfig() {
  getAuthorityConfig();
  const clientId = required("DISCORD_CLIENT_ID");
  const clientSecret = required("DISCORD_CLIENT_SECRET");
  const redirectUri = required("DISCORD_REDIRECT_URI");
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    throw new AuthConfigurationError();
  }
  const local =
    process.env.NODE_ENV !== "production" &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    !isDiscordId(clientId) ||
    (url.protocol !== "https:" && !local) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/api/auth/discord/callback"
  )
    throw new AuthConfigurationError();
  return { clientId, clientSecret, redirectUri, origin: url.origin };
}
