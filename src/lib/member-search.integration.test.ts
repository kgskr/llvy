import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
import {
  authAccounts,
  authSessions,
  gameParticipants,
  games,
  members,
  riotAccounts,
} from "@/db/schema";
import {
  client,
  db,
  migrateTestDatabase,
  resetTestDatabase,
} from "@/test/database";
import { createTestSession } from "@/test/auth";

const mocks = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => ({ db: (await import("@/test/database")).db }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: mocks.token }) }),
}));
import {
  autocompleteSearch,
  autocompleteStoredNicknames,
  resolveSearchMember,
  resolveNicknameMember,
} from "./nickname-search";
import { getMemberHistoryReadModel } from "./read-model";
import { createMember, deleteMember, updateMember } from "./member-mutations";
import { UnauthorizedError } from "./auth-errors";
import { GET } from "@/app/api/search/autocomplete/route";

beforeAll(migrateTestDatabase, 30_000);
beforeEach(async () => {
  await resetTestDatabase();
  vi.stubEnv("REDIS_URL", "");
  mocks.token = (await createTestSession("owner")).token;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(() => client.close());

async function member(name: string) {
  const [row] = await db
    .insert(members)
    .values({ name, birthYear: 1987 })
    .returning();
  return row;
}
async function account(
  memberId: string | null,
  gameName: string,
  tagLine = "KR1",
  history: "active" | "excluded" | "none" = "active",
) {
  const [row] = await db
    .insert(riotAccounts)
    .values({ memberId, gameName, tagLine, puuid: randomUUID() })
    .returning();
  if (history !== "none") {
    const [game] = await db
      .insert(games)
      .values({
        fileHash: randomUUID(),
        blobUrl: "https://fixture.invalid/replay.rofl",
        playedAt: "2026-10-01",
        playedAtSource: "file_mtime",
        excludedAt: history === "excluded" ? new Date() : null,
      })
      .returning();
    await db
      .insert(gameParticipants)
      .values({ gameId: game.id, riotAccountId: row.id, team: 100 });
  }
  return row;
}
const resolve = (input: string, page = 1) =>
  resolveSearchMember({ mode: "unified", input }, page);

it.each(["q=test", "nickname=test", "q=", "q=a&q=b"])(
  "authenticates one time per real handler/DAL request: %s",
  async (query) => {
    const viewer = await createTestSession("viewer");
    mocks.token = viewer.token;
    const select = vi.spyOn(db, "select");
    const authReads = () =>
      select.mock.calls.filter(
        ([fields]) =>
          fields && "account" in fields && fields.account === authAccounts,
      ).length;
    const request = () =>
      new Request(`http://localhost/api/search/autocomplete?${query}`);
    expect((await GET(request())).status).toBe(query === "q=a&q=b" ? 400 : 200);
    expect(authReads()).toBe(1);
    await db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(eq(authSessions.id, viewer.sessionId));
    select.mockClear();
    expect((await GET(request())).status).toBe(401);
    expect(authReads()).toBe(1);
  },
);

describe("unified member search against the test database", () => {
  it.each(["viewer", "admin", "owner"] as const)(
    "returns full names and at most two previews without private fields for %s",
    async (role) => {
      const m = await member("김길수");
      await account(m.id, "다", "KR1", "none");
      await account(m.id, "나", "KR1", "excluded");
      await account(m.id, "가");
      mocks.token = (await createTestSession(role)).token;
      const select = vi.spyOn(db, "select");
      expect(await autocompleteSearch("김")).toEqual([
        {
          kind: "member",
          id: m.id,
          name: "김길수",
          accounts: [
            { gameName: "가", tagLine: "KR1" },
            { gameName: "나", tagLine: "KR1" },
          ],
        },
      ]);
      const business = select.mock.calls.filter(
        ([fields]) =>
          !(fields && "account" in fields && fields.account === authAccounts),
      );
      expect(business).toHaveLength(2);
      const text = JSON.stringify(await resolve("김길수"));
      expect(text).not.toMatch(/birthYear|discord|puuid|1987/);
      expect(await resolve("김길수")).toEqual({
        kind: "member",
        memberId: m.id,
      });
    },
  );
  it("includes every registered member regardless of accounts/history while keeping Riot eligibility", async () => {
    const empty = await member("신규모임원");
    const noGames = await member("신규계정");
    const excluded = await member("신규제외");
    await account(noGames.id, "no games", "KR1", "none");
    await account(excluded.id, "excluded", "KR1", "excluded");
    await account(null, "unlinked");
    const results = await autocompleteSearch("신규");
    expect(new Set(results.map((r) => r.id))).toEqual(
      new Set([empty.id, noGames.id, excluded.id]),
    );
    for (const q of ["no games", "excluded", "unlinked"])
      expect(await autocompleteSearch(q)).toEqual([]);
    expect(await resolve("신규모임원")).toEqual({
      kind: "member",
      memberId: empty.id,
    });
    expect(
      (await getMemberHistoryReadModel(empty.id)).history?.stats.totalGames,
    ).toBe(0);
    expect(await resolveNicknameMember("신규모임원")).toEqual({
      kind: "missing",
    });
  });
  it("normalizes exact names, treats punctuation literally and never redirects a partial name", async () => {
    for (const name of [
      "김#이#박",
      "%_",
      "Cafe\u0301",
      "İstanbul",
      "ΟΣ",
      "😀모임원",
    ]) {
      const m = await member(name);
      expect((await autocompleteSearch(name))[0].id).toBe(m.id);
      expect(await resolve(` ${name.normalize("NFC").toLowerCase()} `)).toEqual(
        { kind: "member", memberId: m.id },
      );
    }
    expect(await resolve("김#이")).toEqual({ kind: "missing" });
    for (const value of ["", "  ", "가".repeat(101), "\ud800", "김\0"]) {
      expect(await autocompleteSearch(value)).toEqual([]);
      expect(await resolve(value)).toEqual({ kind: "missing" });
    }
  });
  it("merges exact name and Riot matches without favoring either source", async () => {
    const named = await member("충돌");
    const nicknamed = await member("다른사람");
    await account(named.id, "충돌", "KR1");
    await account(nicknamed.id, "충돌", "KR2");
    const result = await resolve("충돌");
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") throw Error("ambiguous required");
    expect(result.total).toBe(2);
    expect(new Set(result.members.map((m) => m.id))).toEqual(
      new Set([named.id, nicknamed.id]),
    );
    expect(await resolve("충돌#KR2")).toEqual({
      kind: "member",
      memberId: nicknamed.id,
    });
    await db
      .update(riotAccounts)
      .set({ memberId: null })
      .where(eq(riotAccounts.memberId, nicknamed.id));
    expect(await resolve("충돌")).toEqual({
      kind: "member",
      memberId: named.id,
    });
  });
  it("groups more than twenty account rows before counting and paginating members", async () => {
    const many = await member("가 다계정");
    const other = await member("나 다른사람");
    for (let i = 0; i < 25; i++)
      await account(many.id, "same", String(i).padStart(2, "0"));
    await account(other.id, "same", "ZZZ");
    const result = await resolveNicknameMember("same");
    expect(result).toMatchObject({
      kind: "ambiguous",
      total: 2,
      page: 1,
      pageCount: 1,
    });
    if (result.kind === "ambiguous") {
      expect(result.members.map((m) => m.id)).toEqual([many.id, other.id]);
      expect(result.members[0].accounts).toHaveLength(2);
    }
  });
  it("keeps all homonyms reachable beyond twenty members in stable UUID order", async () => {
    const rows = await db
      .insert(members)
      .values(Array.from({ length: 43 }, () => ({ name: "동명" })))
      .returning();
    const all: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const result = await resolve("동명", page);
      expect(result).toMatchObject({
        kind: "ambiguous",
        total: 43,
        page,
        pageCount: 3,
      });
      if (result.kind === "ambiguous")
        all.push(...result.members.map((m) => m.id));
    }
    expect(all).toEqual(rows.map((m) => m.id).sort());
    expect(await resolve("동명", Number.MAX_SAFE_INTEGER)).toMatchObject({
      page: 3,
    });
    expect(await resolve("동명", NaN)).toMatchObject({ page: 1 });
  });
  it("resolves current names, deletes and links even after suggestions have been produced", async () => {
    const id = await createMember("변경전", 1987);
    expect((await autocompleteSearch("변경"))[0].id).toBe(id);
    await updateMember(id, "변경후", 1987);
    expect(await resolve("변경전")).toEqual({ kind: "missing" });
    expect((await getMemberHistoryReadModel(id)).history?.member.name).toBe(
      "변경후",
    );
    await deleteMember(id);
    expect((await getMemberHistoryReadModel(id)).history).toBeNull();
    expect(await resolve("변경후")).toEqual({ kind: "missing" });
    const first = await member("첫째"),
      second = await member("둘째");
    const a = await account(first.id, "현재연결");
    await autocompleteStoredNicknames("현재");
    await db
      .update(riotAccounts)
      .set({ memberId: second.id })
      .where(eq(riotAccounts.id, a.id));
    expect(await resolveNicknameMember("현재연결")).toEqual({
      kind: "member",
      memberId: second.id,
    });
  });
  it("requires current sessions even for empty/invalid input and after session revocation", async () => {
    const session = await createTestSession("viewer");
    mocks.token = session.token;
    await autocompleteSearch("김");
    await db.delete(authSessions).where(eq(authSessions.id, session.sessionId));
    for (const value of ["김", "", "\ud800"]) {
      await expect(autocompleteSearch(value)).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
      await expect(resolve(value)).rejects.toBeInstanceOf(UnauthorizedError);
    }
  });
  it("does not turn either source's database failure into partial success or a missing result", async () => {
    await member("김길수");
    const select = db.select.bind(db);
    const spy = vi.spyOn(db, "select");
    for (const column of ["name", "gameName"]) {
      spy.mockImplementation((fields) => {
        if (
          fields &&
          column in fields &&
          (column === "name" || !("name" in fields))
        )
          throw new Error(`failed ${column}`);
        return select(fields);
      });
      await expect(autocompleteSearch("김")).rejects.toThrow(
        `failed ${column}`,
      );
      await expect(resolve("김길수")).rejects.toThrow(`failed ${column}`);
    }
  });
});
