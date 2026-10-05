import { ownerActor, ownerSession } from "@/test/actor";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { del } from "@vercel/blob";
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

import { gameParticipants, games, riotAccounts } from "@/db/schema";

import { formatKoreaDateInput } from "./game-date";
import type { GameParticipantRow } from "./games";
import type { IngestResult } from "./ingest";
import type { CreatedPendingUpload } from "./pending-upload-store";
import { parseRofl, type ParsedGame } from "./rofl/parser";

vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => ({ db: (await import("@/test/database")).db }));
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ownerSession),
}));
vi.mock("@vercel/blob", () => ({ del: vi.fn(async () => {}) }));

// Opt-in only: the private replay stays at its original path, is read without
// modification, and is never copied into fixtures or any persistent database.
const replayFile = process.env.LLVY_REPLAY_FILE;

describe.skipIf(!replayFile)("private replay end-to-end processing", () => {
  let bytes: Uint8Array<ArrayBuffer>;
  let parsed: ParsedGame;
  let lastModified: number;
  let originalFilename: string;
  let database: typeof import("@/test/database");
  let processReplay: typeof import("@/app/api/process/route").POST;
  let gameQueries: typeof import("./games");
  let memberQueries: typeof import("./members");
  let uploadStore: typeof import("./pending-upload-store");
  const fetchReplay = vi.fn<typeof fetch>();
  const authorizedUrls = new Set<string>();

  beforeAll(async () => {
    if (!replayFile) throw new Error("Set LLVY_REPLAY_FILE to a local replay.");
    const [fileBytes, fileStat] = await Promise.all([
      readFile(replayFile),
      stat(replayFile),
    ]);
    bytes = Uint8Array.from(fileBytes);
    parsed = parseRofl(bytes);
    lastModified = Math.trunc(fileStat.mtimeMs);
    originalFilename = basename(replayFile);

    // Keep the skipped default run lightweight. The database and application
    // are imported only when an explicitly supplied local file is being tested.
    database = await import("@/test/database");
    await database.migrateTestDatabase();
    [gameQueries, memberQueries, uploadStore] = await Promise.all([
      import("./games"),
      import("./members"),
      import("./pending-upload-store"),
    ]);
    ({ POST: processReplay } = await import("@/app/api/process/route"));
  }, 30_000);

  beforeEach(async () => {
    await database.resetTestDatabase();
    vi.clearAllMocks();
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_replay-test_secret");
    vi.stubEnv("BLOB_ACCESS", "public");
    authorizedUrls.clear();
    fetchReplay.mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!authorizedUrls.has(url)) {
        throw new Error("Unexpected network request blocked by replay test.");
      }
      return new Response(bytes, {
        headers: { "content-length": String(bytes.byteLength) },
      });
    });
    // There is no network fallback. Fetch, Blob deletion and session auth are
    // mocked; pending state, parsing, ingestion and all queries are real.
    vi.stubGlobal("fetch", fetchReplay);
    // Database driver errors can contain bound player identities. Preserve a
    // generic failing assertion without printing those details to test output.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await database?.client.close();
  });

  async function binding() {
    const pending = await uploadStore.createPendingUpload(
      "replay-test-session",
      ownerActor,
    );
    const blobUrl = `https://replay-test.public.blob.vercel-storage.com/${pending.pathname}`;
    authorizedUrls.add(blobUrl);
    return { ...pending, blobUrl };
  }

  function request(
    pending: CreatedPendingUpload & { blobUrl: string },
    mtime: number | null = lastModified,
  ) {
    return new Request("http://localhost/api/process", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: pending.uploadId,
        nonce: pending.nonce,
        blobUrl: pending.blobUrl,
        originalFilename,
        lastModified: mtime,
      }),
    });
  }

  async function process(
    pending: CreatedPendingUpload & { blobUrl: string },
    mtime: number | null = lastModified,
  ): Promise<IngestResult> {
    const response = await processReplay(request(pending, mtime));
    expect(
      response.status,
      "Replay processing returned a non-success status",
    ).toBe(200);
    return response.json() as Promise<IngestResult>;
  }

  function comparableParticipant(participant: GameParticipantRow) {
    return {
      gameName: participant.gameName,
      tagLine: participant.tagLine,
      champion: participant.champion,
      team: participant.team,
      position: participant.position,
      win: participant.win,
      kills: participant.kills,
      deaths: participant.deaths,
      assists: participant.assists,
      goldEarned: participant.goldEarned,
    };
  }

  it("processes the original bytes and round-trips parsed fields, file date and private participant stats", async () => {
    const pending = await binding();
    const result = await process(pending);
    expect(result.duplicate).toBe(false);
    const detail = await gameQueries.getGameDetail(result.gameId);
    expect(detail).not.toBeNull();
    expect(detail?.durationMs).toBe(parsed.durationMs);
    expect(detail?.gameVersion).toBe(parsed.gameVersion);
    expect(detail?.winningTeam).toBe(parsed.winningTeam);
    expect(detail?.playedAtSource).toBe("file_mtime");
    expect(detail?.playedAt).toBe(formatKoreaDateInput(new Date(lastModified)));
    expect(detail?.originalFilename === originalFilename).toBe(true);
    expect(detail?.participants.length).toBe(parsed.participants.length);

    const expected = parsed.participants.map((participant) => ({
      gameName: participant.riotGameName,
      tagLine: participant.riotTagLine,
      champion: participant.champion,
      team: participant.team,
      position: participant.position,
      win: participant.win,
      kills: participant.kills,
      deaths: participant.deaths,
      assists: participant.assists,
      goldEarned: participant.goldEarned,
    }));
    const actual = detail!.participants.map(comparableParticipant);
    const sort = (a: { gameName: string; tagLine: string }, b: typeof a) =>
      JSON.stringify([a.gameName, a.tagLine]).localeCompare(
        JSON.stringify([b.gameName, b.tagLine]),
      );
    // Compare inside the process, but report only a boolean on mismatch so
    // player names and IDs never appear in assertion diffs or snapshots.
    expect(
      isDeepStrictEqual(actual.sort(sort), expected.sort(sort)),
      "Participant fields changed between parsing and database retrieval",
    ).toBe(true);
    const [stored] = await database.db.select().from(games);
    expect(stored.blobUrl).toBe(pending.blobUrl);
    expect(
      stored.fileHash === createHash("sha256").update(bytes).digest("hex"),
    ).toBe(true);
    expect(isDeepStrictEqual(stored.rawMetadata, parsed.rawMetadata)).toBe(
      true,
    );
    const list = await gameQueries.listGames();
    expect(list).toHaveLength(1);
    expect(list[0].participantCount).toBe(parsed.participants.length);
    expect(list[0].playedAt).toBe(formatKoreaDateInput(new Date(lastModified)));
    expect(await uploadStore.getPendingUpload(pending.uploadId)).toMatchObject({
      state: "processed",
      blobUrl: pending.blobUrl,
    });
    expect(del).not.toHaveBeenCalled();
    expect(vi.mocked(console.error).mock.calls.length).toBe(0);
  });

  it("returns the same game for a second upload and deletes only the duplicate blob", async () => {
    const first = await binding();
    const original = await process(first);
    const second = await binding();
    const duplicate = await process(second, null);
    expect(duplicate).toEqual({ gameId: original.gameId, duplicate: true });
    expect(await gameQueries.countGames()).toBe(1);
    expect(
      await database.db.select({ id: riotAccounts.id }).from(riotAccounts),
    ).toHaveLength(parsed.participants.length);
    expect(
      await database.db
        .select({ id: gameParticipants.id })
        .from(gameParticipants),
    ).toHaveLength(parsed.participants.length);
    const [stored] = await database.db.select().from(games);
    expect(stored.blobUrl).toBe(first.blobUrl);
    expect(stored.playedAt).toBe(formatKoreaDateInput(new Date(lastModified)));
    expect(del).toHaveBeenCalledExactlyOnceWith(second.blobUrl, {
      token: "vercel_blob_rw_replay-test_secret",
      abortSignal: expect.any(AbortSignal),
    });
    expect(await uploadStore.getPendingUpload(second.uploadId)).toMatchObject({
      state: "processed",
    });
  });

  it("rejects reuse of the consumed binding before fetching or deleting its canonical blob", async () => {
    const pending = await binding();
    await process(pending);
    const callsBefore = fetchReplay.mock.calls.length;
    const response = await processReplay(request(pending));
    expect(response.status).toBe(409);
    expect(fetchReplay).toHaveBeenCalledTimes(callsBefore);
    expect(del).not.toHaveBeenCalled();
    expect(await gameQueries.countGames()).toBe(1);
  });

  it("uses upload time without a file date and resolves a later member link in the stored game", async () => {
    const pending = await binding();
    const before = Date.now();
    const result = await process(pending, null);
    const detail = await gameQueries.getGameDetail(result.gameId);
    expect(detail?.playedAtSource).toBe("upload");
    expect(detail!.playedAt >= formatKoreaDateInput(new Date(before))).toBe(
      true,
    );
    expect(detail!.playedAt <= formatKoreaDateInput(new Date())).toBe(true);
    const accounts = await memberQueries.listUnlinkedAccounts();
    expect(accounts.length).toBe(parsed.participants.length);
    const account = accounts[0];
    const memberId = await memberQueries.createMember(
      "Replay test member",
      null,
    );
    expect(await memberQueries.linkAccount(account.id, memberId)).toBe(true);
    const linkedDetail = await gameQueries.getGameDetail(result.gameId);
    const linked = linkedDetail?.participants.find(
      (participant) => participant.memberId === memberId,
    );
    expect(linked !== undefined).toBe(true);
    expect(
      linked?.gameName === account.gameName &&
        linked?.tagLine === account.tagLine,
    ).toBe(true);
    expect(linked?.memberName).toBe("Replay test member");
    expect((await memberQueries.listUnlinkedAccounts()).length).toBe(
      parsed.participants.length - 1,
    );
    expect(await gameQueries.countGames()).toBe(1);
  });
});
