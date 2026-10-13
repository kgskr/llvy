import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { del } from "@vercel/blob";
import {
  authAccounts,
  authSessions,
  games,
  riotAccounts,
  members,
} from "@/db/schema";
import {
  client,
  db,
  migrateTestDatabase,
  resetTestDatabase,
} from "@/test/database";
import { createTestSession } from "@/test/auth";
import { replayBytes, replayPlayer } from "@/test/replay";

const mocks = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => ({ db: (await import("@/test/database")).db }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (mocks.token ? { value: mocks.token } : undefined),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@vercel/blob", () => ({ del: vi.fn(async () => {}) }));

import { GET as callback } from "@/app/api/auth/discord/callback/route";
import { POST as processReplay } from "@/app/api/process/route";
import { createLoginAttempt, LOGIN_ATTEMPT_COOKIE } from "./oauth-attempts";
import { getSession } from "./session";
import { createPendingUpload, getPendingUpload } from "./pending-upload-store";
import { ingestReplay } from "./ingest";
import { parseRofl, RoflParseError } from "./rofl/parser";
import { validateMemberInput } from "./validation";
import { createMemberAction } from "@/app/(app)/admin/actions";
import { createMember, linkAccount } from "./member-mutations";
import { resolveNicknameMember } from "./nickname-search";
import { normalizeSearchText } from "./search-normalization";
import unicode from "./search-unicode-data.json";

beforeAll(migrateTestDatabase, 30_000);
beforeEach(async () => {
  await resetTestDatabase();
  vi.stubEnv("REDIS_URL", "");
  vi.stubEnv("VERCEL", "");
  mocks.token = (await createTestSession("owner")).token;
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_review_secret");
  vi.stubEnv("BLOB_ACCESS", "public");
  vi.mocked(del).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(() => client.close());

it.each(["absent", "pending"])(
  "rejects delayed first login after newer %s and permits a fresh eligible login",
  async (denial) => {
    const userId = "777777777777777777";
    const first = await createLoginAttempt("/");
    const second = await createLoginAttempt("/");
    let membershipCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const path = new URL(String(url)).pathname;
        if (path.endsWith("/oauth2/token"))
          return Response.json({
            access_token: "review-token",
            token_type: "Bearer",
            expires_in: 600,
            scope: "identify",
          });
        if (path.endsWith("/users/@me"))
          return Response.json({ id: userId, username: "review-user" });
        membershipCalls++;
        return membershipCalls !== 2
          ? Response.json({ user: { id: userId }, pending: false })
          : denial === "absent"
            ? Response.json({ code: 10007 }, { status: 404 })
            : Response.json({ user: { id: userId }, pending: true });
      }),
    );
    const reachedSign = Promise.withResolvers<void>();
    const releaseSign = Promise.withResolvers<void>();
    const actualSign = crypto.subtle.sign.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "sign").mockImplementationOnce(async (...args) => {
      reachedSign.resolve();
      await releaseSign.promise;
      return actualSign(...args);
    });
    const request = (attempt: typeof first, code: string) =>
      new NextRequest(
        "http://localhost:3000/api/auth/discord/callback?state=" +
          new URL(attempt.url).searchParams.get("state") +
          "&code=" +
          code,
        { headers: { cookie: LOGIN_ATTEMPT_COOKIE + "=" + attempt.binding } },
      );
    const older = callback(request(first, "first"));
    await reachedSign.promise;
    try {
      const newer = await callback(request(second, "second"));
      expect(newer.headers.get("location")).toBe("/login?error=membership");
      expect(
        await db
          .select()
          .from(authAccounts)
          .where(eq(authAccounts.discordUserId, userId)),
      ).toHaveLength(0);
    } finally {
      releaseSign.resolve();
    }
    const accepted = await older;
    expect(accepted.headers.get("location")).toBe("/login?error=unavailable");
    expect(accepted.cookies.get("llvy_session")).toBeUndefined();
    expect(
      await db
        .select()
        .from(authAccounts)
        .where(eq(authAccounts.discordUserId, userId)),
    ).toHaveLength(0);
    const retry = await callback(
      request(await createLoginAttempt("/"), "retry"),
    );
    expect(retry.headers.get("location")).toBe("/");
    mocks.token = retry.cookies.get("llvy_session")?.value;
    expect(await getSession()).toMatchObject({
      discordUserId: userId,
      role: "viewer",
    });
    const [account] = await db
      .select()
      .from(authAccounts)
      .where(eq(authAccounts.discordUserId, userId));
    expect(account.status).toBe("active");
    expect(
      await db
        .select()
        .from(authSessions)
        .where(eq(authSessions.accountId, account.id)),
    ).toHaveLength(1);
  },
);

it("older and undated replays preserve the latest linked nickname and current-name search", async () => {
  const actor = (await getSession())!;
  const ingest = (name: string, lastModified: number | null) =>
    ingestReplay({
      bytes: replayBytes({
        players: [replayPlayer({ RIOT_ID_GAME_NAME: name })],
      }),
      blobUrl: "https://review.invalid/" + name + ".rofl",
      originalFilename: "review.rofl",
      lastModified,
      actor,
    });
  await ingest("CurrentName", Date.parse("2026-10-10T00:00:00Z"));
  const [account] = await db.select().from(riotAccounts);
  const memberId = await createMember("리뷰 모임원", null);
  await linkAccount(account.id, memberId);
  expect(await resolveNicknameMember("CurrentName#KR1")).toEqual({
    kind: "member",
    memberId,
  });
  await ingest("FormerName", Date.parse("2026-09-01T00:00:00Z"));
  await ingest("UndatedName", null);
  expect((await db.select().from(riotAccounts))[0]).toMatchObject({
    id: account.id,
    memberId,
    gameName: "CurrentName",
  });
  expect(await resolveNicknameMember("CurrentName#KR1")).toEqual({
    kind: "member",
    memberId,
  });
  expect(await db.select().from(games)).toHaveLength(3);
});

it.each(["Bad\0Name", "Bad\ud800Name"])(
  "rejects unsupported Unicode %j with 422 and bound Blob cleanup",
  async (name) => {
    const bytes = replayBytes({
      players: [replayPlayer({ RIOT_ID_GAME_NAME: name })],
    });
    expect(() => parseRofl(bytes)).toThrow(RoflParseError);
    const actor = (await getSession())!;
    const pending = await createPendingUpload(actor.token, actor);
    const blobUrl =
      "https://review.public.blob.vercel-storage.com/" + pending.pathname;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(Uint8Array.from(bytes))),
    );
    const response = await processReplay(
      new Request("http://localhost/api/process", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...pending,
          blobUrl,
          originalFilename: "review.rofl",
        }),
      }),
    );
    expect(response.status).toBe(422);
    expect(del).toHaveBeenCalledWith(
      blobUrl,
      expect.objectContaining({ token: "vercel_blob_rw_review_secret" }),
    );
    expect((await getPendingUpload(pending.uploadId))?.state).toBe("failed");
    expect(await db.select().from(games)).toHaveLength(0);
  },
);

it("member validation rejects NUL before the Server Action reaches storage", async () => {
  const name = "김\0모임원";
  expect(validateMemberInput(name, "")).toEqual({
    ok: false,
    error: "이름에 사용할 수 없는 문자가 있습니다.",
  });
  const input = new FormData();
  input.set("name", name);
  const result = await createMemberAction(null, input);
  expect(result).toEqual({
    status: "error",
    message: "이름에 사용할 수 없는 문자가 있습니다.",
  });
  expect(await db.select().from(members)).toHaveLength(0);
});

it("deeply nested participant data is rejected as a controlled parse error", () => {
  const base = JSON.stringify(replayPlayer());
  const raw =
    "[" +
    base.slice(0, -1) +
    ',"extra":' +
    "[".repeat(12_000) +
    "0" +
    "]".repeat(12_000) +
    "}]";
  const bytes = replayBytes({ metadata: { statsJson: raw } });
  expect(() => parseRofl(bytes)).toThrow(RoflParseError);
});

it.each([
  "RIOT_ID_TAG_LINE",
  "PUUID",
  "SKIN",
  "VISION_SCORE",
  "WIN",
  "TEAM_POSITION",
])("rejects unsupported Unicode in retained or interpreted %s", (key) => {
  for (const value of ["bad\0text", "bad\udffftext"]) {
    expect(() =>
      parseRofl(replayBytes({ players: [replayPlayer({ [key]: value })] })),
    ).toThrow(RoflParseError);
  }
});

it("rejects bad metadata and filenames while accepting legitimate emoji/combining text", async () => {
  for (const key of ["gameVersion", "lastGameChunkId"]) {
    expect(() =>
      parseRofl(replayBytes({ metadata: { [key]: "bad\ud800" } })),
    ).toThrow(RoflParseError);
  }
  await expect(
    ingestReplay({
      bytes: replayBytes(),
      blobUrl: "https://fixture.invalid/replay",
      originalFilename: "bad\0.rofl",
      lastModified: null,
      actor: (await getSession())!,
    }),
  ).rejects.toBeInstanceOf(RoflParseError);
  for (const name of ["김😀길수", "Cafe\u0301"]) {
    expect(
      parseRofl(
        replayBytes({ players: [replayPlayer({ RIOT_ID_GAME_NAME: name })] }),
      ).participants[0].riotGameName,
    ).toBe(name);
    await expect(createMember(name, null)).resolves.toEqual(expect.any(String));
  }
  for (const name of ["bad\0", "bad\ud800"]) {
    expect(validateMemberInput(name, "").ok).toBe(false);
    await expect(createMember(name, null)).rejects.toThrow(
      "이름에 사용할 수 없는 문자",
    );
  }
});

it("keeps SQL, client normalization and Unicode lowercase equivalent", async () => {
  const cases = [
    "İstanbul",
    "ΟΣ",
    "AΣ\u0301",
    "AΣ\u0345",
    "AΣ\u0345A",
    "Σ",
    "A'Σ",
    "AΣ'",
    "AΣ'A",
    "\ufeff CAFE\u0301\u00a0",
    "😀이름",
    "Straße",
    "가\u1100\u1161",
    "A\u{1e6e3}\u0323",
    "\u{105d2}\u0307",
  ];
  expect(normalizeSearchText("A\u{1e6e3}\u0323")).toBe("\u1ea1\u{1e6e3}");
  const letters = [...unicode.upper];
  for (let i = 0; i < letters.length; i += 100)
    cases.push(letters.slice(i, i + 100).join("0"));
  for (const value of cases) {
    const expected = normalizeSearchText(value);
    // Frozen mapping remains identical to the native rule for the version
    // used to generate it; older runtimes still use the shared frozen data.
    if (process.versions.unicode === unicode.unicode)
      expect(expected).toBe(value.normalize("NFC").trim().toLowerCase());
    const result = await client.query<{ value: string }>(
      "select llvy_normalize_search_v1($1) as value",
      [value],
    );
    expect(result.rows[0].value).toBe(expected);
  }
});
