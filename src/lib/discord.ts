import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { isDiscordId } from "@/lib/auth";
import { getBotConfig, getOAuthConfig } from "@/lib/discord-config";
import {
  acquireBotPermit,
  DiscordBusyError,
  DiscordUnavailableError,
  finishBotPermit,
  renewBotPermit,
} from "@/lib/discord-circuit";
import type { DiscordIdentity, MembershipCheck } from "@/lib/auth-store";
import { consumeRequestBudgets } from "@/lib/request-budget";

const API = "https://discord.com/api/v10";
const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
type JsonObject = Record<string, unknown>;
function object(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function profile(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 128 &&
    !value.includes("\0")
  );
}
export class DiscordAuthorizationError extends Error {}

async function request(url: string, init: RequestInit) {
  const controller = new AbortController();
  let response: Response | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        response = await fetch(url, {
          ...init,
          signal: controller.signal,
          cache: "no-store",
          redirect: "error",
        });
        let body: JsonObject | null = null;
        try {
          if (
            Number(response.headers.get("content-length")) >
              MAX_RESPONSE_BYTES ||
            !response.headers
              .get("content-type")
              ?.includes("application/json") ||
            !response.body
          )
            throw new Error("Invalid response");
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let bytes = 0;
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > MAX_RESPONSE_BYTES) {
              await reader.cancel();
              throw new Error("Invalid response");
            }
            chunks.push(chunk.value);
          }
          const data = new Uint8Array(bytes);
          let offset = 0;
          for (const chunk of chunks) {
            data.set(chunk, offset);
            offset += chunk.length;
          }
          const parsed: unknown = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(data),
          );
          if (object(parsed)) body = parsed;
        } catch {
          /* Status still determines bot configuration/rate failures. */
        }
        return { status: response.status, headers: response.headers, body };
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new DiscordUnavailableError());
        }, REQUEST_TIMEOUT_MS);
      }),
    ]);
  } catch {
    if (response)
      return { status: response.status, headers: response.headers, body: null };
    throw new DiscordUnavailableError();
  } finally {
    clearTimeout(timer);
  }
}
function waitMs(value: unknown): number | null {
  if ((typeof value !== "number" && typeof value !== "string") || value === "")
    return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 && seconds < 1e9
    ? Math.max(1, Math.ceil(seconds * 1000))
    : null;
}
function retryMs(headers: Headers, body: JsonObject | null) {
  return Math.max(
    waitMs(headers.get("retry-after")) ?? 0,
    waitMs(body?.retry_after) ?? 0,
    1000,
  );
}
export function authorizationUrl(state: string): string {
  const config = getOAuthConfig();
  const url = new URL("https://discord.com/oauth2/authorize");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "identify",
    state,
  }).toString();
  return url.toString();
}
export async function identifyDiscordUser(
  code: string,
): Promise<DiscordIdentity> {
  const config = getOAuthConfig();
  const token = await request(API + "/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }),
  });
  if (token.status === 400 && token.body?.error === "invalid_grant")
    throw new DiscordAuthorizationError();
  const access = token.body?.access_token;
  const scope = token.body?.scope;
  if (
    token.status !== 200 ||
    typeof access !== "string" ||
    !access ||
    access.length > 2048 ||
    /[\r\n]/.test(access) ||
    token.body?.token_type !== "Bearer" ||
    typeof token.body?.expires_in !== "number" ||
    token.body.expires_in <= 0 ||
    typeof scope !== "string" ||
    scope.split(" ").filter(Boolean).join(" ") !== "identify"
  )
    throw new DiscordUnavailableError();
  // Access/refresh tokens never leave this identity-only call.
  const user = await request(API + "/users/@me", {
    headers: { authorization: "Bearer " + access },
  });
  if (
    user.status !== 200 ||
    !isDiscordId(user.body?.id) ||
    !profile(user.body?.username) ||
    (user.body?.global_name != null && !profile(user.body.global_name))
  )
    throw new DiscordUnavailableError();
  return {
    id: user.body.id,
    username: user.body.username,
    displayName:
      typeof user.body.global_name === "string"
        ? user.body.global_name
        : user.body.username,
  };
}
export async function lookupGuildMember(
  userId: string,
  { deadline = Date.now() + 15_000 }: { deadline?: number } = {},
): Promise<MembershipCheck> {
  if (!isDiscordId(userId)) throw new DiscordUnavailableError();
  const config = getBotConfig();
  // Reserve a full provider timeout after the local capacity wait.
  const waitDeadline = deadline - REQUEST_TIMEOUT_MS;
  const permit = await acquireBotPermit(
    config.clientId,
    config.guildId,
    waitDeadline,
  );
  let healthy = false;
  let attempted = false;
  let block:
    { scope: "global" | "guild"; reason: string; waitMs: number } | undefined;
  try {
    for (;;) {
      if (Date.now() >= waitDeadline) throw new DiscordBusyError();
      if (
        await consumeRequestBudgets([
          { key: permit.globalKey + ":budget", limit: 30, windowMs: 1000 },
        ])
      )
        break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(1000, waitDeadline - Date.now())),
      );
    }
    const result = await db.execute<{ version: string }>(
      sql`select nextval('auth_membership_version_seq')::text as version`,
    );
    const version = Number(result.rows[0].version);
    if (!Number.isSafeInteger(version) || version < 1)
      throw new DiscordUnavailableError();
    await renewBotPermit(permit);
    if (Date.now() >= waitDeadline) throw new DiscordBusyError();
    attempted = true;
    const response = await request(
      API + "/guilds/" + config.guildId + "/members/" + userId,
      { headers: { authorization: "Bot " + config.botToken } },
    );
    if (
      response.status === 401 ||
      response.status === 403 ||
      (response.status === 404 && response.body?.code === 10004)
    ) {
      block = {
        scope: response.status === 401 ? "global" : "guild",
        reason:
          response.status === 401 ? "bot_unauthorized" : "guild_inaccessible",
        waitMs: 60_000,
      };
      throw new DiscordUnavailableError();
    }
    if (response.status === 429) {
      const global =
        response.body?.global === true ||
        response.headers.get("x-ratelimit-global") === "true" ||
        response.headers.get("x-ratelimit-scope") === "global" ||
        response.body?.global !== false;
      block = {
        scope: global ? "global" : "guild",
        reason: global ? "global_rate_limit" : "bucket_rate_limit",
        waitMs: global
          ? Math.max(60_000, retryMs(response.headers, response.body))
          : retryMs(response.headers, response.body),
      };
      throw new DiscordUnavailableError(Math.ceil(block.waitMs / 1000));
    }
    let status: MembershipCheck["status"];
    if (response.status === 404 && response.body?.code === 10007)
      status = "absent";
    else if (
      response.status === 200 &&
      object(response.body?.user) &&
      response.body.user.id === userId &&
      (response.body.pending === undefined ||
        typeof response.body.pending === "boolean")
    )
      status = response.body.pending === true ? "pending" : "member";
    else throw new DiscordUnavailableError();
    healthy = true;
    if (response.headers.get("x-ratelimit-remaining") === "0")
      block = {
        scope: "guild",
        reason: "bucket_rate_limit",
        waitMs:
          waitMs(response.headers.get("x-ratelimit-reset-after")) ?? 60_000,
      };
    return {
      userId,
      guildId: config.guildId,
      version,
      status,
      checkedAt: new Date(),
    };
  } finally {
    await finishBotPermit(permit, { healthy, block, attempted });
  }
}
