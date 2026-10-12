import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";
import {
  adminGrants,
  auditLogs,
  authAccounts,
  authReconciliationRuns,
  authSessions,
  discordApiControls,
  members,
  oauthLoginAttempts,
  requestBudgets,
} from "@/db/schema";
import {
  client,
  db,
  migrateTestDatabase,
  resetTestDatabase,
} from "@/test/database";
import { createTestSession } from "@/test/auth";
import { ownerActor } from "@/test/actor";
const mocks = vi.hoisted(() => ({
  token: undefined as string | undefined,
  fetch: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => ({ db: (await import("@/test/database")).db }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (mocks.token ? { value: mocks.token } : undefined),
  }),
}));
import { GET as start } from "@/app/api/auth/discord/route";
import { GET as callback } from "@/app/api/auth/discord/callback/route";
import { GET as maintenance } from "@/app/api/maintenance/auth/route";
import { SESSION_COOKIE, getAuthorityConfig, readSessionToken } from "./auth";
import {
  completeDiscordLogin,
  hashReference,
  saveMembership,
} from "./auth-store";
import { getSession } from "./session";
import {
  grantAdministrator,
  listLoginAccounts,
  revokeAdministrator,
} from "./account-administration";
import { identifyDiscordUser, lookupGuildMember } from "./discord";
import {
  DiscordUnavailableError,
  DiscordBusyError,
  acquireBotPermit,
  circuitKeys,
  finishBotPermit,
  renewBotPermit,
} from "./discord-circuit";
import {
  createLoginAttempt,
  consumeLoginAttempt,
  LOGIN_ATTEMPT_COOKIE,
} from "./oauth-attempts";
import {
  cleanupExpiredAuthentication,
  getAuthenticationMaintenanceStatus,
  reconcileGuildAccounts,
} from "./auth-maintenance";
import { withActorTransaction } from "./audit";

const USER = "444444444444444444";
function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(body, { status, headers });
}
function successfulFetch(url: string | URL | Request) {
  const path = new URL(String(url)).pathname;
  return Promise.resolve(
    path.endsWith("/oauth2/token")
      ? json({
          access_token: "user-oauth-token",
          refresh_token: "discarded-refresh-token",
          scope: "identify",
          token_type: "Bearer",
          expires_in: 600,
        })
      : path.endsWith("/users/@me")
        ? json({ id: USER, username: "discord-user", global_name: "표시 이름" })
        : json({ user: { id: path.split("/").at(-1) }, pending: false }),
  );
}
function request(path: string, binding?: string) {
  return new NextRequest("http://localhost:3000" + path, {
    headers: binding ? { cookie: LOGIN_ATTEMPT_COOKIE + "=" + binding } : {},
  });
}
function callbackRequest(
  attempt: Awaited<ReturnType<typeof createLoginAttempt>>,
  code: string,
) {
  return request(
    "/api/auth/discord/callback?state=" +
      new URL(attempt.url).searchParams.get("state") +
      "&code=" +
      code,
    attempt.binding,
  );
}
function holdFirstMemberRequest(
  fallback: (
    url: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response> = successfulFetch,
) {
  const held = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<string>();
  let holding = false;
  mocks.fetch.mockImplementation((url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.includes("/guilds/") && !holding) {
      holding = true;
      started.resolve(path.split("/").at(-1)!);
      return held.promise;
    }
    return fallback(url, init);
  });
  return { started: started.promise, release: held.resolve };
}
beforeAll(migrateTestDatabase, 30_000);
beforeEach(async () => {
  await resetTestDatabase();
  mocks.token = (await createTestSession("owner")).token;
  mocks.fetch.mockReset().mockImplementation(successfulFetch);
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(() => client.close());

describe("Discord login with a real isolated PostgreSQL database", () => {
  it("bounds stored attempts during sustained unauthenticated starts without daily cleanup", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const base = Date.now();
    for (let i = 0; i < 600; i++) {
      vi.setSystemTime(base + Math.floor(i / 10) * 61_000);
      const response = await start(request("/api/auth/discord"));
      expect(response.headers.get("location")).toMatch(
        /^https:\/\/discord\.com\/oauth2\/authorize/,
      );
    }
    const remaining = await db.select().from(oauthLoginAttempts);
    expect(remaining.length).toBeLessThanOrEqual(110);
    expect(remaining.every((row) => row.expiresAt.getTime() > Date.now())).toBe(
      true,
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
    vi.setSystemTime(base + 86_400_000);
    expect(await cleanupExpiredAuthentication()).toMatchObject({
      attempts: remaining.length,
    });
    expect(await db.select().from(oauthLoginAttempts)).toEqual([]);
  });
  it("reclaims only a bounded expired batch and preserves usable callback bindings", async () => {
    const live = await createLoginAttempt("/games");
    await db.insert(oauthLoginAttempts).values(
      Array.from({ length: 1000 }, (_, i) => ({
        stateHash: hashReference("expired-" + i),
        bindingHash: hashReference("binding-" + i),
        redirectTo: "/",
        expiresAt: new Date(0),
      })),
    );
    await createLoginAttempt("/");
    const rows = await db.select().from(oauthLoginAttempts);
    expect(rows.filter((row) => row.expiresAt.getTime() === 0)).toHaveLength(
      980,
    );
    expect(
      await consumeLoginAttempt(
        new URL(live.url).searchParams.get("state"),
        live.binding,
      ),
    ).toEqual({ redirectTo: "/games" });
  });
  it("rolls back expiry reclamation when the new attempt cannot be stored", async () => {
    await createLoginAttempt("/");
    await db.update(oauthLoginAttempts).set({ expiresAt: new Date(0) });
    const before = await db.select().from(oauthLoginAttempts);
    await client.exec(
      `CREATE FUNCTION reject_attempt_insert() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'attempt storage unavailable'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER reject_attempt_insert BEFORE INSERT ON oauth_login_attempts FOR EACH ROW EXECUTE FUNCTION reject_attempt_insert();`,
    );
    try {
      await expect(createLoginAttempt("/")).rejects.toThrow();
      expect(await db.select().from(oauthLoginAttempts)).toEqual(before);
    } finally {
      await client.exec(
        "DROP TRIGGER reject_attempt_insert ON oauth_login_attempts; DROP FUNCTION reject_attempt_insert();",
      );
    }
  });
  it("creates browser-bound identify-only login and atomically issues an independent account session", async () => {
    const begin = await start(request("/api/auth/discord?redirectTo=%2Fgames"));
    const url = new URL(begin.headers.get("location")!);
    expect(url.searchParams.get("scope")).toBe("identify");
    const binding = begin.cookies.get(LOGIN_ATTEMPT_COOKIE)!.value;
    const stored = (await db.select().from(oauthLoginAttempts))[0];
    expect(stored.stateHash).not.toBe(url.searchParams.get("state"));
    expect(stored.bindingHash).not.toBe(binding);
    const result = await callback(
      request(
        "/api/auth/discord/callback?state=" +
          url.searchParams.get("state") +
          "&code=valid-code",
        binding,
      ),
    );
    expect(result.headers.get("location")).toBe("/games");
    expect(result.headers.get("cache-control")).toBe("no-store");
    mocks.token = result.cookies.get(SESSION_COOKIE)!.value;
    const actor = await getSession();
    expect(actor).toMatchObject({
      role: "viewer",
      discordUserId: USER,
      name: "표시 이름",
    });
    expect(actor).not.toHaveProperty("memberId");
    expect(await db.select().from(members)).toEqual([]);
    const session = (
      await db
        .select()
        .from(authSessions)
        .where(eq(authSessions.accountId, actor!.accountId))
    )[0];
    expect(session.referenceHash).not.toBe(
      (await readSessionToken(mocks.token))!.reference,
    );
    const dump =
      JSON.stringify(await db.select().from(authAccounts)) +
      JSON.stringify(await db.select().from(authSessions)) +
      JSON.stringify(await db.select().from(auditLogs));
    expect(dump).not.toMatch(
      /user-oauth-token|discarded-refresh-token|valid-code|test-bot-token|test-oauth-secret/,
    );
    expect(mocks.fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://discord.com/api/v10/oauth2/token",
      "https://discord.com/api/v10/users/@me",
      "https://discord.com/api/v10/guilds/222222222222222222/members/" + USER,
    ]);
    expect(mocks.fetch.mock.calls[1][1].headers.authorization).toBe(
      "Bearer user-oauth-token",
    );
    expect(mocks.fetch.mock.calls[2][1].headers.authorization).toBe(
      "Bot test-bot-token",
    );
  });
  it("consumes one attempt exactly once and rejects a mismatching browser", async () => {
    const attempt = await createLoginAttempt("https://outside.invalid");
    const state = new URL(attempt.url).searchParams.get("state");
    expect(await consumeLoginAttempt(state, "wrong-browser")).toBeNull();
    const results = await Promise.all([
      consumeLoginAttempt(state, attempt.binding),
      consumeLoginAttempt(state, attempt.binding),
    ]);
    expect(results.filter(Boolean)).toEqual([{ redirectTo: "/" }]);
  });
  it.each(["missing", "duplicate", "both", "expired", "wrong-browser"])(
    "rejects %s callbacks before any provider request",
    async (kind) => {
      const attempt = await createLoginAttempt("/");
      const state = new URL(attempt.url).searchParams.get("state")!;
      if (kind === "expired")
        await db.update(oauthLoginAttempts).set({ expiresAt: new Date(0) });
      const query =
        kind === "missing"
          ? "code=x"
          : "state=" +
            state +
            "&code=x" +
            (kind === "duplicate"
              ? "&code=y"
              : kind === "both"
                ? "&error=access_denied"
                : "");
      const response = await callback(
        request(
          "/api/auth/discord/callback?" + query,
          kind === "wrong-browser" ? "wrong" : attempt.binding,
        ),
      );
      expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );
  it("consumes a cancellation without contacting Discord", async () => {
    const attempt = await createLoginAttempt("/");
    const state = new URL(attempt.url).searchParams.get("state");
    expect(
      (
        await callback(
          request(
            "/api/auth/discord/callback?state=" +
              state +
              "&error=access_denied",
            attempt.binding,
          ),
        )
      ).headers.get("location"),
    ).toContain("cancelled");
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(await consumeLoginAttempt(state, attempt.binding)).toBeNull();
  });
  it.each(["absent", "pending"])(
    "refuses initial %s membership without registering an account",
    async (kind) => {
      mocks.fetch.mockImplementation((url: string) =>
        String(url).includes("/members/")
          ? Promise.resolve(
              kind === "absent"
                ? json({ code: 10007 }, 404)
                : json({ user: { id: USER }, pending: true }),
            )
          : successfulFetch(url),
      );
      const attempt = await createLoginAttempt("/");
      const state = new URL(attempt.url).searchParams.get("state");
      const result = await callback(
        request(
          "/api/auth/discord/callback?state=" + state + "&code=x",
          attempt.binding,
        ),
      );
      expect(result.headers.get("location")).toContain("membership");
      expect(
        await db
          .select()
          .from(authAccounts)
          .where(eq(authAccounts.discordUserId, USER)),
      ).toEqual([]);
      expect(result.cookies.get(SESSION_COOKIE)).toBeUndefined();
    },
  );
  it("rejects missing scopes and mismatching member identity", async () => {
    mocks.fetch.mockResolvedValueOnce(
      json({
        access_token: "secret",
        token_type: "Bearer",
        expires_in: 600,
        scope: "email",
      }),
    );
    await expect(identifyDiscordUser("code")).rejects.toBeInstanceOf(
      DiscordUnavailableError,
    );
    mocks.fetch.mockResolvedValueOnce(json({ user: { id: "999" } }));
    await expect(lookupGuildMember(USER)).rejects.toBeInstanceOf(
      DiscordUnavailableError,
    );
  });
  it("rejects duplicate concurrent first-login completion rather than storing duplicate accounts", async () => {
    const check = await lookupGuildMember(USER);
    const user = { id: USER, username: "user", displayName: "user" };
    const outcomes = await Promise.allSettled([
      completeDiscordLogin(user, check),
      completeDiscordLogin(user, check),
    ]);
    expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(
      await db
        .select()
        .from(authAccounts)
        .where(eq(authAccounts.discordUserId, USER)),
    ).toHaveLength(1);
  });
});

describe("bounded provider failures and login admission", () => {
  it.each([401, 403])(
    "opens a %s circuit even for a non-JSON provider response",
    async (status) => {
      mocks.fetch.mockResolvedValueOnce(
        new Response("invalid provider body", { status }),
      );
      await expect(lookupGuildMember(USER)).rejects.toBeInstanceOf(
        DiscordUnavailableError,
      );
      await expect(lookupGuildMember(USER)).rejects.toThrow();
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("treats Unknown Guild as configuration failure and unrelated 404 as unresolved", async () => {
    mocks.fetch.mockResolvedValueOnce(json({ code: 10004 }, 404));
    await expect(lookupGuildMember(USER)).rejects.toThrow();
    expect(
      (await db.select().from(discordApiControls)).some(
        (row) => row.reason === "guild_inaccessible",
      ),
    ).toBe(true);
    await db.delete(discordApiControls);
    mocks.fetch.mockResolvedValueOnce(json({ code: 10001 }, 404));
    await expect(lookupGuildMember(USER)).rejects.toThrow();
    expect(await db.select().from(auditLogs)).toEqual([]);
  });
  it("rejects oversized streamed bodies and preserves existing authority", async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ user: { id: USER }, padding: "x".repeat(65536) }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    await expect(lookupGuildMember(USER)).rejects.toThrow();
    expect(await getSession()).toMatchObject({ role: "owner" });
  });
  it("expires the whole provider request including body reads", async () => {
    vi.useFakeTimers();
    const pending = new ReadableStream({ start() {} });
    mocks.fetch.mockResolvedValueOnce(
      new Response(pending, {
        headers: { "content-type": "application/json" },
      }),
    );
    const result = expect(lookupGuildMember(USER)).rejects.toBeInstanceOf(
      DiscordUnavailableError,
    );
    // DB preparation runs with real microtasks; wait until fetch has started.
    for (let i = 0; i < 100 && mocks.fetch.mock.calls.length === 0; i++)
      await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalled(), {
        interval: 1,
        timeout: 100,
      });
    await vi.advanceTimersByTimeAsync(5001);
    await result;
  });
  it("does not exchange OAuth while a known global block is active and returns its wait", async () => {
    mocks.fetch.mockResolvedValueOnce(
      json({ global: true, retry_after: 180 }, 429),
    );
    await expect(lookupGuildMember(USER)).rejects.toThrow();
    const attempt = await createLoginAttempt("/");
    const state = new URL(attempt.url).searchParams.get("state");
    const response = await callback(
      request(
        "/api/auth/discord/callback?state=" + state + "&code=x",
        attempt.binding,
      ),
    );
    expect(response.headers.get("Retry-After")).toBe("180");
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects spent or missing trusted-IP budgets before provider calls", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    const response = await callback(
      request("/api/auth/discord/callback?state=x&code=x"),
    );
    expect(response.headers.get("location")).toContain("throttled");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("refuses to renew an expired permit held by a stalled worker", async () => {
    const config = getAuthorityConfig();
    const permit = await acquireBotPermit(
      process.env.DISCORD_CLIENT_ID!,
      config.guildId,
    );
    await db.update(discordApiControls).set({ probeUntil: new Date(0) });
    await expect(renewBotPermit(permit)).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("reopens a failed recovery probe on timeout or generic provider failure", async () => {
    mocks.fetch.mockResolvedValueOnce(json({}, 401));
    await expect(lookupGuildMember(USER)).rejects.toThrow();
    await db.update(discordApiControls).set({ blockedUntil: new Date(0) });
    mocks.fetch.mockRejectedValueOnce(new Error("network unavailable"));
    await expect(lookupGuildMember(USER)).rejects.toThrow();
    await expect(lookupGuildMember(USER)).rejects.toThrow();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(
      (await db.select().from(discordApiControls)).some(
        (row) => row.reason === "probe_unavailable",
      ),
    ).toBe(true);
  });
});

describe("grant and bounded daily cleanup races", () => {
  it("completes two overlapping OAuth callbacks without repeating code exchange", async () => {
    const otherUser = "555555555555555555";
    const firstAttempt = await createLoginAttempt("/games");
    const nextAttempt = await createLoginAttempt("/members");
    const held = holdFirstMemberRequest(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/oauth2/token")) {
        const code = new URLSearchParams(String(init?.body)).get("code")!;
        return json({
          access_token: code,
          scope: "identify",
          token_type: "Bearer",
          expires_in: 600,
        });
      }
      if (path.endsWith("/users/@me")) {
        const token = new Headers(init?.headers).get("authorization");
        return json({
          id: token === "Bearer first-code" ? USER : otherUser,
          username: "discord-user",
        });
      }
      return successfulFetch(url);
    });
    const first = callback(callbackRequest(firstAttempt, "first-code"));
    expect(await held.started).toBe(USER);
    const next = callback(callbackRequest(nextAttempt, "next-code"));
    await vi.waitFor(() =>
      expect(
        mocks.fetch.mock.calls.filter(([url]) =>
          String(url).endsWith("/users/@me"),
        ),
      ).toHaveLength(2),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    held.release(json({ user: { id: USER }, pending: false }));
    const responses = await Promise.all([first, next]);
    expect(
      responses.map((response) => response.headers.get("location")),
    ).toEqual(["/games", "/members"]);
    for (const response of responses)
      expect(response.cookies.get(SESSION_COOKIE)).toBeDefined();
    expect(
      mocks.fetch.mock.calls.filter(([url]) =>
        String(url).endsWith("/oauth2/token"),
      ),
    ).toHaveLength(2);
    expect(
      (await db.select().from(authAccounts)).map(
        (account) => account.discordUserId,
      ),
    ).toEqual(expect.arrayContaining([USER, otherUser]));
  });
  it("lets a login wait for an in-flight Cron lookup and both complete", async () => {
    const attempt = await createLoginAttempt("/games");
    const held = holdFirstMemberRequest();
    const run = reconcileGuildAccounts();
    const heldUser = await held.started;
    const login = callback(callbackRequest(attempt, "valid-code"));
    await vi.waitFor(() =>
      expect(
        mocks.fetch.mock.calls.some(([url]) =>
          String(url).endsWith("/users/@me"),
        ),
      ).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    held.release(json({ user: { id: heldUser }, pending: false }));
    expect((await login).cookies.get(SESSION_COOKIE)).toBeDefined();
    expect(await run).toMatchObject({ status: "completed", failed: 0 });
  });
  it("lets Cron wait for an in-flight login and finish in the same run", async () => {
    const attempt = await createLoginAttempt("/games");
    const held = holdFirstMemberRequest();
    const login = callback(callbackRequest(attempt, "valid-code"));
    expect(await held.started).toBe(USER);
    const run = reconcileGuildAccounts();
    await vi.waitFor(async () =>
      expect((await db.select().from(authReconciliationRuns))[0].status).toBe(
        "running",
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    held.release(json({ user: { id: USER }, pending: false }));
    expect((await login).cookies.get(SESSION_COOKIE)).toBeDefined();
    expect(await run).toMatchObject({ status: "completed", failed: 0 });
  });
  it("allows an owner grant to wait for another healthy member lookup", async () => {
    const target = await createTestSession("viewer");
    const held = holdFirstMemberRequest();
    const lookup = lookupGuildMember(USER);
    await held.started;
    const grant = Promise.allSettled([grantAdministrator(target.accountId)]);
    await new Promise((resolve) => setTimeout(resolve, 150));
    held.release(json({ user: { id: USER }, pending: false }));
    await lookup;
    expect(await grant).toEqual([
      { status: "fulfilled", value: expect.any(String) },
    ]);
    expect(await db.select().from(adminGrants)).toHaveLength(1);
  });
  it("preserves the unchecked Cron cursor without failure when capacity uses its time budget", async () => {
    const config = getAuthorityConfig();
    const permit = await acquireBotPermit(
      process.env.DISCORD_CLIENT_ID!,
      config.guildId,
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    const time = Date.now();
    const run = reconcileGuildAccounts();
    await vi.waitFor(async () =>
      expect((await db.select().from(authReconciliationRuns))[0].status).toBe(
        "running",
      ),
    );
    // Keep the competing worker's permit alive up to the operation deadline.
    await db
      .update(discordApiControls)
      .set({ probeUntil: new Date(time + 60_000) });
    vi.setSystemTime(time + 40_000);
    expect(await run).toMatchObject({
      status: "partial",
      examined: 0,
      failed: 0,
    });
    expect(
      (await db.select().from(authReconciliationRuns))[0].cursor,
    ).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(await getSession()).toMatchObject({ role: "owner" });
    await finishBotPermit(permit, { healthy: false, attempted: false });
    expect(await reconcileGuildAccounts()).toMatchObject({
      status: "completed",
      examined: 1,
      failed: 0,
    });
  });
  it("rejects a grant when a later denial is recorded during its provider request", async () => {
    const target = await createTestSession("viewer");
    mocks.fetch.mockImplementationOnce(async () => {
      await saveMembership({
        userId: target.discordUserId,
        guildId: getAuthorityConfig().guildId,
        status: "absent",
        version: Number.MAX_SAFE_INTEGER - 1,
        checkedAt: new Date(),
      });
      return json({ user: { id: target.discordUserId }, pending: false });
    });
    await expect(grantAdministrator(target.accountId)).rejects.toThrow();
    expect(await db.select().from(adminGrants)).toEqual([]);
    mocks.token = target.token;
    expect(await getSession()).toBeNull();
  });
  it("never grants a pending member and records only a confirmed suspension", async () => {
    const target = await createTestSession("viewer");
    mocks.fetch.mockResolvedValueOnce(
      json({ user: { id: target.discordUserId }, pending: true }),
    );
    await expect(grantAdministrator(target.accountId)).rejects.toThrow();
    expect(await db.select().from(adminGrants)).toEqual([]);
    expect(
      (
        await db
          .select()
          .from(authAccounts)
          .where(eq(authAccounts.id, target.accountId))
      )[0].status,
    ).toBe("suspended");
  });
  it("allows only one overlapping reconciliation and includes the owner in departure cleanup", async () => {
    let resolve!: (response: Response) => void;
    const waiting = new Promise<Response>((done) => {
      resolve = done;
    });
    mocks.fetch.mockReturnValueOnce(waiting);
    const first = reconcileGuildAccounts();
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    expect(await reconcileGuildAccounts()).toEqual({ status: "busy" });
    resolve(json({ code: 10007 }, 404));
    expect(await first).toMatchObject({ status: "completed", suspended: 1 });
    expect(await getSession()).toBeNull();
  });
  it("resumes a partial batch and checks all registered accounts without live sessions", async () => {
    const rows = Array.from({ length: 205 }, (_, i) => ({
      id: "00000000-0000-4000-8000-" + String(i + 1).padStart(12, "0"),
      discordUserId: String(600000000 + i),
      username: "user" + i,
      displayName: "user" + i,
      guildId: getAuthorityConfig().guildId,
    }));
    await db
      .insert(authAccounts)
      .values(rows.map((row) => ({ ...row, membershipCheckedAt: new Date() })));
    vi.useFakeTimers({ toFake: ["Date"] });
    let time = Date.now();
    mocks.fetch.mockImplementation(async (url: string) => {
      time += 100;
      vi.setSystemTime(time);
      return String(url).endsWith(rows[204].discordUserId)
        ? json({ code: 10007 }, 404)
        : json({ user: { id: String(url).split("/").at(-1) }, pending: false });
    });
    expect(await reconcileGuildAccounts()).toMatchObject({
      status: "partial",
      examined: 200,
      failed: 0,
    });
    expect(await getAuthenticationMaintenanceStatus()).toMatchObject({
      lastCompletedAt: null,
    });
    expect(await reconcileGuildAccounts()).toMatchObject({
      status: "completed",
      examined: 206,
      suspended: 1,
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(206);
    const run = (await db.select().from(authReconciliationRuns))[0];
    expect(run.cursor).toBeNull();
    expect(run.lastCompletedAt).toBeInstanceOf(Date);
    expect(
      (
        await db
          .select()
          .from(authAccounts)
          .where(eq(authAccounts.id, rows[204].id))
      )[0].status,
    ).toBe("suspended");
  });
});

describe("shared bot circuit and provider-independent authority", () => {
  it("bounds a healthy permit wait without calling Discord or opening a circuit", async () => {
    const permit = await acquireBotPermit(
      process.env.DISCORD_CLIENT_ID!,
      process.env.DISCORD_GUILD_ID!,
    );
    await expect(
      lookupGuildMember(USER, { deadline: Date.now() + 5_100 }),
    ).rejects.toBeInstanceOf(DiscordBusyError);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(
      (await db.select().from(discordApiControls)).every(
        (row) => row.reason === null,
      ),
    ).toBe(true);
    await finishBotPermit(permit, { healthy: false, attempted: false });
    await expect(lookupGuildMember(USER)).resolves.toMatchObject({
      status: "member",
    });
  });
  it("waits for a local request budget to reset instead of failing the lookup", async () => {
    const keys = circuitKeys(
      process.env.DISCORD_CLIENT_ID!,
      process.env.DISCORD_GUILD_ID!,
    );
    await db.insert(requestBudgets).values({
      key: keys.globalKey + ":budget",
      count: 30,
      resetAt: new Date(Date.now() + 100),
    });
    await expect(lookupGuildMember(USER)).resolves.toMatchObject({
      status: "member",
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("does not reopen a recovery circuit when the local budget expires before a provider call", async () => {
    mocks.fetch.mockResolvedValueOnce(json({}, 401));
    await expect(lookupGuildMember(USER)).rejects.toThrow();
    await db.update(discordApiControls).set({ blockedUntil: new Date(0) });
    const keys = circuitKeys(
      process.env.DISCORD_CLIENT_ID!,
      process.env.DISCORD_GUILD_ID!,
    );
    await db
      .update(requestBudgets)
      .set({ count: 30, resetAt: new Date(Date.now() + 10_000) })
      .where(eq(requestBudgets.key, keys.globalKey + ":budget"));
    await expect(
      lookupGuildMember(USER, { deadline: Date.now() + 5_100 }),
    ).rejects.toBeInstanceOf(DiscordBusyError);
    const control = (await db.select().from(discordApiControls)).find(
      (row) => row.key === keys.globalKey,
    )!;
    expect(control).toMatchObject({
      reason: "bot_unauthorized",
      probeOwner: null,
      version: 1,
    });
    expect(control.blockedUntil).toEqual(new Date(0));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await db
      .delete(requestBudgets)
      .where(eq(requestBudgets.key, keys.globalKey + ":budget"));
    await expect(lookupGuildMember(USER)).resolves.toMatchObject({
      status: "member",
    });
  });
  it.each([401, 403, 429])(
    "stops waiting callers when an in-flight call opens a %s block",
    async (status) => {
      const held = holdFirstMemberRequest();
      const first = expect(lookupGuildMember(USER)).rejects.toBeInstanceOf(
        DiscordUnavailableError,
      );
      await held.started;
      const waiting = expect(
        lookupGuildMember("555555555555555555"),
      ).rejects.toBeInstanceOf(DiscordUnavailableError);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
      held.release(
        json(status === 429 ? { global: true, retry_after: 180 } : {}, status),
      );
      await Promise.all([first, waiting]);
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("keeps a single recovery probe in flight and resumes waiters after successful recovery", async () => {
    mocks.fetch.mockResolvedValueOnce(json({}, 401));
    await expect(lookupGuildMember(USER)).rejects.toThrow();
    await db.update(discordApiControls).set({ blockedUntil: new Date(0) });
    const held = holdFirstMemberRequest();
    const first = lookupGuildMember(USER);
    await held.started;
    const waiting = lookupGuildMember("555555555555555555");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    held.release(json({ user: { id: USER }, pending: false }));
    expect(await Promise.all([first, waiting])).toEqual([
      expect.objectContaining({ userId: USER, status: "member" }),
      expect.objectContaining({
        userId: "555555555555555555",
        status: "member",
      }),
    ]);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(
      (await db.select().from(discordApiControls)).every(
        (row) => row.reason === null,
      ),
    ).toBe(true);
  });
  it.each([401, 403])(
    "shares a %s block across subsequent callers",
    async (status) => {
      mocks.fetch.mockResolvedValueOnce(
        json({ message: "configuration failure" }, status),
      );
      await expect(lookupGuildMember(USER)).rejects.toBeInstanceOf(
        DiscordUnavailableError,
      );
      await expect(lookupGuildMember(USER)).rejects.toBeInstanceOf(
        DiscordUnavailableError,
      );
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
      expect(await getSession()).toMatchObject({ role: "owner" });
    },
  );
  it("keeps longer global Retry-After and cannot bypass it by token rotation", async () => {
    mocks.fetch.mockResolvedValueOnce(
      json({ global: true, retry_after: 180 }, 429),
    );
    await expect(lookupGuildMember(USER)).rejects.toMatchObject({
      retryAfterSeconds: 180,
    });
    vi.stubEnv("DISCORD_BOT_TOKEN", "replacement-token");
    await expect(lookupGuildMember(USER)).rejects.toBeInstanceOf(
      DiscordUnavailableError,
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const keys = circuitKeys(
      process.env.DISCORD_CLIENT_ID!,
      process.env.DISCORD_GUILD_ID!,
    );
    expect(
      (
        await db
          .select()
          .from(discordApiControls)
          .where(eq(discordApiControls.key, keys.globalKey))
      )[0].reason,
    ).toBe("global_rate_limit");
  });
  it("distinguishes a bucket rate limit from a global one", async () => {
    mocks.fetch.mockResolvedValueOnce(
      json({ global: false, retry_after: 2 }, 429),
    );
    await expect(lookupGuildMember(USER)).rejects.toMatchObject({
      retryAfterSeconds: 2,
    });
    const rows = await db.select().from(discordApiControls);
    expect(rows.find((x) => x.reason === "bucket_rate_limit")!.key).toContain(
      ":guild:",
    );
    expect(rows.find((x) => x.key.endsWith(":bot"))!.blockedUntil).toBeNull();
  });
  it("allows one expiring shared probe and an old success cannot clear a newer block", async () => {
    mocks.fetch.mockResolvedValueOnce(json({}, 401));
    await expect(lookupGuildMember(USER)).rejects.toThrow();
    await db.update(discordApiControls).set({ blockedUntil: new Date(0) });
    const first = await acquireBotPermit(
      process.env.DISCORD_CLIENT_ID!,
      process.env.DISCORD_GUILD_ID!,
    );
    await expect(
      acquireBotPermit(
        process.env.DISCORD_CLIENT_ID!,
        process.env.DISCORD_GUILD_ID!,
        Date.now() + 100,
      ),
    ).rejects.toBeInstanceOf(DiscordUnavailableError);
    await db.update(discordApiControls).set({ probeUntil: new Date(0) });
    const next = await acquireBotPermit(
      process.env.DISCORD_CLIENT_ID!,
      process.env.DISCORD_GUILD_ID!,
    );
    await finishBotPermit(next, {
      healthy: false,
      block: { scope: "global", reason: "bot_unauthorized", waitMs: 60_000 },
    });
    await finishBotPermit(first, { healthy: true });
    await expect(lookupGuildMember(USER)).rejects.toBeInstanceOf(
      DiscordUnavailableError,
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("does not call providers for stale viewer/admin/owner sessions or local revocation", async () => {
    const admin = await createTestSession("admin");
    const viewer = await createTestSession("viewer");
    await db.update(authAccounts).set({ membershipCheckedAt: new Date(0) });
    vi.stubEnv("DISCORD_BOT_TOKEN", "");
    vi.stubEnv("DISCORD_CLIENT_SECRET", "");
    for (const session of [admin, viewer]) {
      mocks.token = session.token;
      expect(await getSession()).toMatchObject({ role: session.role });
    }
    mocks.token = (await createTestSession("owner")).token;
    expect(await revokeAdministrator(admin.accountId)).toBe(true);
    mocks.token = admin.token;
    expect(await getSession()).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("blocks membership calls when shared state storage fails", async () => {
    const spy = vi
      .spyOn(db, "transaction")
      .mockRejectedValueOnce(new Error("database unavailable"));
    await expect(lookupGuildMember(USER)).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("daily membership reconciliation and independent accounts", () => {
  it("grants an inactive registered target without OAuth tokens or a live session", async () => {
    const target = await createTestSession("viewer");
    await db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(eq(authSessions.accountId, target.accountId));
    const grantId = await grantAdministrator(target.accountId);
    expect(
      await db.select().from(adminGrants).where(eq(adminGrants.id, grantId)),
    ).toHaveLength(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(
      (await listLoginAccounts()).accounts.find(
        (x) => x.id === target.accountId,
      )!.role,
    ).toBe("admin");
  });
  it("suspends a departed administrator and revokes all sessions/grants with system audit", async () => {
    const target = await createTestSession("admin");
    mocks.fetch.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).endsWith(target.discordUserId)
          ? json({ code: 10007 }, 404)
          : json({
              user: { id: String(url).split("/").at(-1) },
              pending: false,
            }),
      ),
    );
    expect(await reconcileGuildAccounts()).toMatchObject({
      status: "completed",
      suspended: 1,
    });
    expect(
      (
        await db
          .select()
          .from(authAccounts)
          .where(eq(authAccounts.id, target.accountId))
      )[0].status,
    ).toBe("suspended");
    expect(
      await db
        .select()
        .from(authSessions)
        .where(
          and(
            eq(authSessions.accountId, target.accountId),
            isNull(authSessions.revokedAt),
          ),
        ),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(adminGrants)
        .where(
          and(
            eq(adminGrants.accountId, target.accountId),
            isNull(adminGrants.revokedAt),
          ),
        ),
    ).toEqual([]);
    expect(
      (
        await db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.action, "auth.account_suspended"))
      )[0],
    ).toMatchObject({
      actorRole: "system",
      actorAccountId: null,
      targetId: target.accountId,
    });
    mocks.token = target.token;
    expect(await getSession()).toBeNull();
    await expect(
      withActorTransaction(target, async () => true),
    ).rejects.toThrow();
  });
  it("rejoins as viewer without reviving the old grant or session", async () => {
    const target = await createTestSession("admin");
    mocks.fetch.mockResolvedValueOnce(json({ code: 10007 }, 404));
    await saveMembership(await lookupGuildMember(target.discordUserId));
    const restored = await completeDiscordLogin(
      {
        id: target.discordUserId,
        username: "new-name",
        displayName: "새 표시 이름",
      },
      await lookupGuildMember(target.discordUserId),
    );
    mocks.token = restored.token;
    expect(await getSession()).toMatchObject({
      role: "viewer",
      accountId: target.accountId,
    });
    mocks.token = target.token;
    expect(await getSession()).toBeNull();
    expect(
      (
        await db
          .select()
          .from(adminGrants)
          .where(eq(adminGrants.id, target.adminGrantId!))
      )[0].revokedAt,
    ).not.toBeNull();
  });
  it("does not let an older positive or denial overwrite a newer decision", async () => {
    const target = await createTestSession("viewer");
    const older = await lookupGuildMember(target.discordUserId);
    mocks.fetch.mockResolvedValueOnce(json({ code: 10007 }, 404));
    const newer = await lookupGuildMember(target.discordUserId);
    expect(await saveMembership(newer)).toBe(true);
    expect(await saveMembership(older)).toBe(false);
    const admitted = await completeDiscordLogin(
      { id: target.discordUserId, username: "user", displayName: "user" },
      await lookupGuildMember(target.discordUserId),
    );
    expect(await saveMembership(newer)).toBe(false);
    mocks.token = admitted.token;
    expect(await getSession()).not.toBeNull();
  });
  it("does not suspend unresolved accounts on bot failure and leaves daily progress partial", async () => {
    const target = await createTestSession("admin");
    mocks.fetch.mockResolvedValueOnce(json({}, 403));
    expect(await reconcileGuildAccounts()).toMatchObject({ status: "partial" });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    mocks.token = target.token;
    expect(await getSession()).toMatchObject({ role: "admin" });
    expect(await db.select().from(auditLogs)).toEqual([]);
  });
  it("keeps local expiry cleanup operational when bot reconciliation fails", async () => {
    const expired = await createTestSession("viewer");
    await db
      .update(authSessions)
      .set({ expiresAt: new Date(0) })
      .where(eq(authSessions.id, expired.sessionId));
    vi.stubEnv("CRON_SECRET", "cron-test-secret");
    mocks.fetch.mockResolvedValueOnce(json({}, 401));
    const response = await maintenance(
      new Request("http://localhost/api/maintenance/auth", {
        headers: { authorization: "Bearer cron-test-secret" },
      }),
    );
    expect(await response.json()).toMatchObject({
      cleanup: { sessions: 1 },
      membership: { status: "partial" },
    });
    expect(
      await db
        .select()
        .from(authSessions)
        .where(eq(authSessions.id, expired.sessionId)),
    ).toEqual([]);
    const count = mocks.fetch.mock.calls.length;
    expect(
      (await maintenance(new Request("http://localhost/api/maintenance/auth")))
        .status,
    ).toBe(401);
    expect(mocks.fetch).toHaveBeenCalledTimes(count);
  });
  it("rejects unknown targets and requires no member relationship", async () => {
    await expect(grantAdministrator(randomUUID())).rejects.toThrow();
    const target = await createTestSession("viewer", { name: "동명 사용자" });
    await db.insert(members).values({ name: "동명 사용자" });
    const grant = await grantAdministrator(target.accountId);
    expect(grant).toBeTruthy();
    expect(
      (
        await db
          .select()
          .from(authAccounts)
          .where(eq(authAccounts.id, target.accountId))
      )[0],
    ).not.toHaveProperty("memberId");
    expect(getAuthorityConfig().ownerUserId).toBe(ownerActor.discordUserId);
    expect(hashReference(target.token)).not.toBe(target.token);
  });
});
