import { setTimeout as delay } from "node:timers/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
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
import * as schema from "@/db/schema";

const state = vi.hoisted(() => ({
  token: undefined as string | undefined,
  pool: undefined as import("pg").Pool | undefined,
  queries: [] as { query: string; params: unknown[] }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (state.token ? { value: state.token } : undefined),
  }),
}));
vi.mock("@/db", async () => {
  const connectionString = process.env.LLVY_POSTGRES_TEST_URL;
  if (!connectionString) return { db: undefined };
  // Explicit opt-in to a disposable local database; never use POSTGRES_URL.
  const url = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/llvy_auth_test" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "LLVY_POSTGRES_TEST_URL must target a disposable local llvy_auth_test database.",
    );
  }
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  state.pool = new Pool({
    connectionString,
    max: 6,
    application_name: "llvy-auth-regression",
    statement_timeout: 10_000,
    lock_timeout: 5_000,
  });
  return {
    db: drizzle(state.pool, {
      schema: await import("@/db/schema"),
      logger: {
        logQuery(query, params) {
          state.queries.push({ query, params });
        },
      },
    }),
  };
});
import { createSessionToken, randomReference } from "@/lib/auth";
import {
  completeDiscordLogin,
  hashReference,
  saveMembership,
  type MembershipCheck,
} from "@/lib/auth-store";
import { getSession, UnauthorizedError } from "@/lib/session";
import { resolveSearchMember } from "@/lib/nickname-search";
import { normalizeSearchText } from "@/lib/search-normalization";
import unicode from "@/lib/search-unicode-data.json";
import {
  AccountIneligibleError,
  grantAdministrator,
  revokeAdministrator,
} from "@/lib/account-administration";
import { createLoginAttempt, consumeLoginAttempt } from "@/lib/oauth-attempts";

const OWNER_USER = "111111111111111111";
const TARGET_USER = "444444444444444444";
const GUILD = "222222222222222222";
const FIRST = "10000000-0000-4000-8000-000000000001";
const SECOND = "20000000-0000-4000-8000-000000000002";
const BARRIER = 137918;

async function waitForLock(advisory: boolean) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const result = await state.pool!.query(
      `select 1 from pg_stat_activity where application_name = 'llvy-auth-regression'
       and wait_event_type = 'Lock' and (wait_event = 'advisory') = $1`,
      [advisory],
    );
    if (result.rowCount) return;
    await delay(10);
  }
  throw new Error("Expected concurrent operation to reach its database lock");
}

describe.skipIf(!process.env.LLVY_POSTGRES_TEST_URL)(
  "authentication concurrency and indexed search on PostgreSQL",
  () => {
    beforeAll(async () => {
      await migrate(drizzle(state.pool!, { schema }), {
        migrationsFolder: "drizzle",
      });
    }, 30_000);
    beforeEach(async () => {
      await state.pool!.query(
        "TRUNCATE auth_membership_decisions, audit_logs, admin_grants, auth_sessions, auth_accounts, pending_uploads, oauth_login_attempts, discord_api_controls, request_budgets, game_participants, games, riot_accounts, members CASCADE",
      );
      state.queries = [];
      vi.stubEnv(
        "AUTH_SECRET",
        "isolated-postgres-test-secret-more-than-32-bytes",
      );
      vi.stubEnv("DISCORD_OWNER_USER_ID", OWNER_USER);
      vi.stubEnv("DISCORD_GUILD_ID", GUILD);
      vi.stubEnv("DISCORD_CLIENT_ID", "333333333333333333");
      vi.stubEnv("DISCORD_CLIENT_SECRET", "isolated-client-secret");
      vi.stubEnv("DISCORD_BOT_TOKEN", "isolated-bot-token");
      vi.stubEnv(
        "DISCORD_REDIRECT_URI",
        "http://localhost:3000/api/auth/discord/callback",
      );
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ code: 10007 }, { status: 404 })),
      );
    });
    afterEach(() => {
      state.token = undefined;
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });
    afterAll(async () => {
      await state.pool?.end();
    });

    it.each([
      ["absent", true],
      ["absent", false],
      ["pending", true],
      ["pending", false],
    ] as const)(
      "serializes first registration with newer %s (denial commits first: %s)",
      async (status, denialFirst) => {
        const identity = {
          id: TARGET_USER,
          username: "new-user",
          displayName: "새 사용자",
        };
        const eligible: MembershipCheck = {
          userId: TARGET_USER,
          guildId: GUILD,
          version: 10,
          status: "member",
          checkedAt: new Date(),
        };
        const denied = { ...eligible, version: 20, status };
        await state.pool!.query(`
          CREATE FUNCTION pause_membership_decision() RETURNS trigger AS $$
          BEGIN
            IF NEW.version = ${denialFirst ? 20 : 10} THEN
              PERFORM pg_advisory_xact_lock(${BARRIER});
            END IF;
            RETURN NEW;
          END; $$ LANGUAGE plpgsql;
          CREATE TRIGGER pause_membership_decision AFTER INSERT OR UPDATE
          ON auth_membership_decisions FOR EACH ROW
          EXECUTE FUNCTION pause_membership_decision();
        `);
        const barrier = await state.pool!.connect();
        const operations: Promise<unknown>[] = [];
        try {
          await barrier.query("select pg_advisory_lock($1)", [BARRIER]);
          const login = () =>
            completeDiscordLogin(identity, eligible).catch(
              (error: unknown) => error,
            );
          const deny = () => saveMembership(denied);
          const first = denialFirst ? deny() : login();
          operations.push(first);
          await waitForLock(true);
          const second = denialFirst ? login() : deny();
          operations.push(second);
          await waitForLock(false);
          await barrier.query("select pg_advisory_unlock($1)", [BARRIER]);
          const results = await Promise.all([first, second]);
          if (denialFirst) {
            expect(results[1]).toBeInstanceOf(UnauthorizedError);
            expect(
              (await state.pool!.query("select id from auth_accounts")).rows,
            ).toHaveLength(0);
          } else {
            expect(results[0]).toMatchObject({ role: "viewer" });
            expect(results[1]).toBe(true);
            expect(
              (await state.pool!.query("select status from auth_accounts"))
                .rows[0].status,
            ).toBe("suspended");
          }
          expect(
            (
              await state.pool!.query(
                "select id from auth_sessions where revoked_at is null",
              )
            ).rows,
          ).toHaveLength(0);
          await expect(
            completeDiscordLogin(identity, eligible),
          ).rejects.toThrow(UnauthorizedError);
          const fresh = { ...eligible, version: 30 };
          state.token = (await completeDiscordLogin(identity, fresh)).token;
          expect(await saveMembership(denied)).toBe(false);
          await expect(completeDiscordLogin(identity, fresh)).rejects.toThrow(
            UnauthorizedError,
          );
          expect(await getSession()).toMatchObject({
            discordUserId: TARGET_USER,
            role: "viewer",
          });
        } finally {
          await barrier.query("select pg_advisory_unlock($1)", [BARRIER]);
          barrier.release();
          await Promise.allSettled(operations);
          await state.pool!.query(
            "DROP TRIGGER pause_membership_decision ON auth_membership_decisions; DROP FUNCTION pause_membership_decision();",
          );
        }
      },
    );

    it("uses selective indexes for exact searches across 10,000 members and accounts", async () => {
      state.token = (
        await completeDiscordLogin(
          { id: OWNER_USER, username: "owner", displayName: "owner" },
          {
            userId: OWNER_USER,
            guildId: GUILD,
            version: 1,
            status: "member",
            checkedAt: new Date(),
          },
        )
      ).token;
      // Direct SQL is only fixture setup; exercise production search afterward.
      await state.pool!.query(`
        INSERT INTO members(id, name)
        SELECT md5(i::text)::uuid, CASE WHEN i=1 THEN 'QueryTarget' ELSE 'Member-' || i END
        FROM generate_series(1,10000) AS i;
        INSERT INTO riot_accounts(member_id,game_name,tag_line,puuid)
        SELECT md5(i::text)::uuid, CASE WHEN i<=2 THEN 'QueryTarget' ELSE 'Account-' || i END,
          'KR1', i::text FROM generate_series(1,10000) AS i;
        INSERT INTO riot_accounts(member_id,game_name,tag_line,puuid)
        SELECT md5('2')::uuid,'QueryTarget','KR1','extra-' || i FROM generate_series(1,25) AS i;
        INSERT INTO games(id,file_hash,blob_url,played_at,played_at_source)
        VALUES ('${FIRST}','search-fixture','https://example.invalid/fixture','2026-10-10','file_mtime');
        INSERT INTO game_participants(game_id,riot_account_id)
        SELECT '${FIRST}',id FROM riot_accounts;
        ANALYZE members; ANALYZE riot_accounts; ANALYZE games; ANALYZE game_participants;
      `);
      for (const input of [
        { mode: "unified", input: "QUERYTARGET" },
        { mode: "nickname", input: "QueryTarget#kr1" },
      ] as const) {
        state.queries = [];
        const result = await resolveSearchMember(input);
        expect(result).toMatchObject({
          kind: "ambiguous",
          total: 2,
          pageCount: 1,
        });
        if (result.kind !== "ambiguous")
          throw new Error("Expected member choices");
        expect(result.members).toHaveLength(2);
        expect(
          result.members.every((member) => member.accounts.length <= 2),
        ).toBe(true);
        const queries = state.queries.filter(({ query }) =>
          query.includes('"matching_members"'),
        );
        expect(queries).toHaveLength(2);
        for (const { query, params } of queries) {
          const explanation = await state.pool!.query(
            "EXPLAIN (ANALYZE, FORMAT JSON) " + query,
            params,
          );
          const plan = explanation.rows[0]["QUERY PLAN"][0].Plan;
          const nodes: Record<string, unknown>[] = [];
          function visit(node: Record<string, unknown>) {
            nodes.push(node);
            for (const child of (node.Plans ?? []) as Record<string, unknown>[])
              visit(child);
          }
          visit(plan);
          expect(nodes.map((node) => node["Index Name"])).toContain(
            "riot_accounts_normalized_name_idx",
          );
          if (input.mode === "unified")
            expect(nodes.map((node) => node["Index Name"])).toContain(
              "members_normalized_name_idx",
            );
          expect(
            nodes.filter(
              (node) =>
                node["Node Type"] === "Seq Scan" &&
                ["members", "riot_accounts"].includes(
                  String(node["Relation Name"]),
                ),
            ),
          ).toHaveLength(0);
          expect(plan["Actual Rows"]).toBeLessThanOrEqual(40);
        }
      }
    }, 30_000);

    it("preserves canonical Unicode composition and combining order on PostgreSQL 17", async () => {
      const inputs = [" İSTANBUL ", "ΟΣ", "ΟΣΑ", "😀가", "\uFEFFMixed\uFEFF"];
      // All canonical decompositions include modern scripts absent from PG 17's
      // Unicode tables, plus every Hangul syllable and older composition pair.
      for (let cp = 1; cp <= 0x10ffff; cp++) {
        if (cp >= 0xd800 && cp <= 0xdfff) continue;
        const value = String.fromCodePoint(cp);
        const decomposed = value.normalize("NFD");
        if (value !== decomposed) inputs.push(decomposed);
      }
      for (const [composed, decomposed] of Object.entries(
        unicode.nfcCompatibility.decompositions,
      )) {
        inputs.push(composed, decomposed, "A" + decomposed + "\u0301");
      }
      // Old/new marks in both orders, with starters and leading non-starters.
      for (const mark of Object.keys(unicode.nfcCompatibility.classes)) {
        inputs.push(
          "A" + mark + "\u{1E5EE}",
          "A\u{1E5EE}" + mark,
          mark + "\u{1E5EE}\u0323",
          "\u{1E5EE}" + mark + "\u0301",
        );
      }
      for (let start = 0; start < inputs.length; start += 500) {
        const batch = inputs.slice(start, start + 500);
        if (process.versions.unicode === unicode.unicode) {
          expect(batch.map(normalizeSearchText)).toEqual(
            batch.map((value) => value.normalize("NFC").trim().toLowerCase()),
          );
        }
        const { rows } = await state.pool!.query(
          "select llvy_normalize_search_v1(value) as normalized from unnest($1::text[]) with ordinality as source(value, ordinal) order by ordinal",
          [batch],
        );
        expect(rows.map((row) => row.normalized)).toEqual(
          batch.map(normalizeSearchText),
        );
      }
    }, 30_000);

    it.each([true, false])(
      "serializes grant-time denial with revocation (owner sorts first: %s)",
      async (ownerFirst) => {
        const owner = ownerFirst ? FIRST : SECOND;
        const target = ownerFirst ? SECOND : FIRST;
        await state.pool!.query(
          `insert into auth_accounts (id, discord_user_id, username, display_name, guild_id, membership_checked_at)
       values ($1,$2,'owner','owner',$5,now()), ($3,$4,'target','target',$5,now())`,
          [owner, OWNER_USER, target, TARGET_USER, GUILD],
        );
        const reference = randomReference();
        state.token = await createSessionToken(reference);
        await state.pool!.query(
          `insert into auth_sessions (account_id, reference_hash, guild_id, expires_at)
       values ($1,$2,$3,now()+interval '1 day'), ($4,'target-session',$3,now()+interval '1 day')`,
          [owner, hashReference(reference), GUILD, target],
        );
        await state.pool!.query(
          "insert into admin_grants (account_id, issued_by) values ($1,$2)",
          [target, owner],
        );
        // Pause actual suspension after its account SELECT locks and before the
        // revoked_by FK lookup. The competing service can now acquire its locks.
        await state.pool!.query(`
      CREATE FUNCTION pause_auth_suspension() RETURNS trigger AS $$
      BEGIN
        IF NEW.status = 'suspended' THEN PERFORM pg_advisory_xact_lock(${BARRIER}); END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER pause_auth_suspension BEFORE UPDATE ON auth_accounts
      FOR EACH ROW EXECUTE FUNCTION pause_auth_suspension();
    `);
        const barrier = await state.pool!.connect();
        const operations: Promise<unknown>[] = [];
        try {
          await barrier.query("select pg_advisory_lock($1)", [BARRIER]);
          const denial = grantAdministrator(target).catch(
            (error: unknown) => error,
          );
          operations.push(denial);
          await waitForLock(true);
          const revocation = revokeAdministrator(target).catch(
            (error: unknown) => error,
          );
          operations.push(revocation);
          await waitForLock(false);
          await barrier.query("select pg_advisory_unlock($1)", [BARRIER]);
          expect(await denial).toBeInstanceOf(AccountIneligibleError);
          expect(await revocation).toBe(false); // suspension already retired the grant
          expect(
            (
              await state.pool!.query(
                "select status from auth_accounts where id=$1",
                [target],
              )
            ).rows[0].status,
          ).toBe("suspended");
          expect(
            (
              await state.pool!.query(
                "select count(*)::int as n from auth_sessions where account_id=$1 and revoked_at is null",
                [target],
              )
            ).rows[0].n,
          ).toBe(0);
          expect(
            (
              await state.pool!.query(
                "select revoked_by, revoked_at from admin_grants",
              )
            ).rows[0],
          ).toMatchObject({ revoked_by: owner, revoked_at: expect.any(Date) });
        } finally {
          await barrier.query("select pg_advisory_unlock($1)", [BARRIER]);
          barrier.release();
          await Promise.allSettled(operations);
          await state.pool!.query(
            "DROP TRIGGER pause_auth_suspension ON auth_accounts; DROP FUNCTION pause_auth_suspension();",
          );
        }
      },
    );

    it("reclaims expired attempts without waiting on locked rows or deleting a live callback", async () => {
      const live = await createLoginAttempt("/games");
      for (let i = 0; i < 40; i++) {
        await state.pool!.query(
          "insert into oauth_login_attempts(state_hash,binding_hash,redirect_to,expires_at) values ($1,$2,'/',now()-interval '1 day')",
          [hashReference("state-" + i), hashReference("binding-" + i)],
        );
      }
      const blocker = await state.pool!.connect();
      let starts: Promise<unknown> | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query(
          "select state_hash from oauth_login_attempts where expires_at <= now() order by expires_at, state_hash limit 20 for update",
        );
        starts = Promise.all([
          createLoginAttempt("/"),
          createLoginAttempt("/"),
        ]);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            starts,
            new Promise((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(new Error("login start waited on expired row locks")),
                1500,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
        expect(
          (
            await state.pool!.query(
              "select count(*)::int as n from oauth_login_attempts where expires_at <= now()",
            )
          ).rows[0].n,
        ).toBe(20);
        expect(
          await consumeLoginAttempt(
            new URL(live.url).searchParams.get("state"),
            live.binding,
          ),
        ).toEqual({ redirectTo: "/games" });
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        await starts;
      }
      await createLoginAttempt("/");
      expect(
        (
          await state.pool!.query(
            "select count(*)::int as n from oauth_login_attempts where expires_at <= now()",
          )
        ).rows[0].n,
      ).toBe(0);
    });
  },
);
