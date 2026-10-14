import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseRofl } from "./rofl/parser";
import { replayBytes, replayPlayer } from "@/test/replay";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const DAY_MS = 24 * 60 * 60 * 1000;

function successfulFetch(name = "아리") {
  vi.mocked(fetch)
    .mockResolvedValueOnce(Response.json(["16.19.1"]))
    .mockResolvedValueOnce(
      Response.json({
        data: {
          Ahri: { id: "Ahri", name },
          Broken: { id: "Broken", name: { unexpected: true } },
        },
      }),
    );
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("champion display names", () => {
  it("localizes known names and retains unknown strings without unsafe remote values", async () => {
    successfulFetch();
    const { resolveChampionNames } = await import("./champions");
    expect(
      Object.fromEntries(
        await resolveChampionNames(["Ahri", "Unknown", "Broken"]),
      ),
    ).toEqual({ Ahri: "아리", Unknown: "Unknown", Broken: "Broken" });
  });

  it("shares the name lookup with portraits and keeps names when image metadata is missing or unsafe", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(["16.19.1"]))
      .mockResolvedValueOnce(
        Response.json({
          data: {
            Ahri: { id: "Ahri", name: "아리", image: { full: "Ahri.png" } },
            Missing: { id: "Missing", name: "이미지 없음" },
            Unsafe: {
              id: "Unsafe",
              name: "잘못된 이미지",
              image: { full: "../Ahri.png" },
            },
          },
        }),
      );
    const { resolveChampionNames, resolveChampionPortraits } =
      await import("./champions");
    const names = ["Ahri", "Missing", "Unsafe", "Unknown"];
    const [displayNames, portraits] = await Promise.all([
      resolveChampionNames(names),
      resolveChampionPortraits(names),
    ]);
    const expectedUrl =
      "https://ddragon.leagueoflegends.com/cdn/16.19.1/img/champion/Ahri.png";
    expect(Object.fromEntries(displayNames)).toEqual({
      Ahri: "아리",
      Missing: "이미지 없음",
      Unsafe: "잘못된 이미지",
      Unknown: "Unknown",
    });
    expect(Object.fromEntries(portraits)).toEqual({ Ahri: expectedUrl });
    portraits.set("Ahri", "caller mutation");
    expect((await resolveChampionPortraits(["Ahri"])).get("Ahri")).toBe(
      expectedUrl,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("expires 24 hours after completion without extending the lifetime on reads", async () => {
    vi.useFakeTimers();
    const versions = deferredResponse();
    vi.mocked(fetch)
      .mockReturnValueOnce(versions.promise)
      .mockResolvedValueOnce(
        Response.json({ data: { Ahri: { id: "Ahri", name: "아리" } } }),
      );
    const { resolveChampionNames } = await import("./champions");
    const initial = resolveChampionNames(["Ahri"]);
    await vi.advanceTimersByTimeAsync(1_500);
    versions.resolve(Response.json(["16.19.1"]));
    expect((await initial).get("Ahri")).toBe("아리");

    await vi.advanceTimersByTimeAsync(DAY_MS - 1);
    expect((await resolveChampionNames(["Ahri"])).get("Ahri")).toBe("아리");
    expect(fetch).toHaveBeenCalledTimes(2);

    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(["16.20.1"]))
      .mockResolvedValueOnce(
        Response.json({
          data: {
            Ahri: { id: "Ahri", name: "갱신된 이름" },
            NewChampion: { id: "NewChampion", name: "새 챔피언" },
          },
        }),
      );
    await vi.advanceTimersByTimeAsync(1);
    expect(
      Object.fromEntries(await resolveChampionNames(["Ahri", "NewChampion"])),
    ).toEqual({ Ahri: "갱신된 이름", NewChampion: "새 챔피언" });
    expect(fetch).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(DAY_MS - 1);
    expect((await resolveChampionNames(["Ahri"])).get("Ahri")).toBe(
      "갱신된 이름",
    );
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])(
    "shares concurrent lookups and isolates caller results (expired: %s)",
    async (expired) => {
      vi.useFakeTimers();
      const { resolveChampionNames } = await import("./champions");
      if (expired) {
        successfulFetch();
        await resolveChampionNames(["Ahri"]);
        await vi.advanceTimersByTimeAsync(DAY_MS);
        vi.mocked(fetch).mockClear();
      }
      vi.mocked(fetch).mockImplementation(async (input) =>
        Response.json(
          String(input).endsWith("/versions.json")
            ? ["16.20.1"]
            : { data: { Ahri: { id: "Ahri", name: "새 이름" } } },
        ),
      );
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          resolveChampionNames(["Ahri", `Unknown${i}`]),
        ),
      );
      expect(fetch).toHaveBeenCalledTimes(2);
      for (const [i, result] of results.entries()) {
        expect(Object.fromEntries(result)).toEqual({
          Ahri: "새 이름",
          [`Unknown${i}`]: `Unknown${i}`,
        });
      }
      results[0].set("Ahri", "caller mutation");
      expect(results[1].get("Ahri")).toBe("새 이름");
      expect((await resolveChampionNames(["Ahri"])).get("Ahri")).toBe(
        "새 이름",
      );
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["error", "http", "empty", "invalid"])(
    "does not reuse an expired map or cache a failed refresh (%s)",
    async (failure) => {
      vi.useFakeTimers();
      successfulFetch();
      const { resolveChampionNames } = await import("./champions");
      await resolveChampionNames(["Ahri"]);
      await vi.advanceTimersByTimeAsync(DAY_MS);
      if (failure === "error") {
        vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
      } else if (failure === "http") {
        vi.mocked(fetch).mockResolvedValueOnce(
          new Response(null, { status: 503 }),
        );
      } else {
        vi.mocked(fetch)
          .mockResolvedValueOnce(Response.json(["16.20.1"]))
          .mockResolvedValueOnce(
            Response.json(failure === "empty" ? { data: {} } : { data: [] }),
          );
      }
      const results = await Promise.all([
        resolveChampionNames(["Ahri"]),
        resolveChampionNames(["Ahri", "Unknown"]),
      ]);
      expect(results.map((result) => result.get("Ahri"))).toEqual([
        "Ahri",
        "Ahri",
      ]);
      successfulFetch("복구된 이름");
      expect((await resolveChampionNames(["Ahri"])).get("Ahri")).toBe(
        "복구된 이름",
      );
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("keeps a new shared retry intact when a timed-out response arrives", async () => {
    vi.useFakeTimers();
    const lateChampions = deferredResponse();
    const retryVersions = deferredResponse();
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(["16.19.1"]))
      .mockReturnValueOnce(lateChampions.promise);
    const { resolveChampionNames } = await import("./champions");
    const initial = resolveChampionNames(["Ahri"]);
    await vi.advanceTimersByTimeAsync(1_500);
    const joined = resolveChampionNames(["Ahri", "Unknown"]);
    await vi.advanceTimersByTimeAsync(500);
    expect((await initial).get("Ahri")).toBe("Ahri");
    expect((await joined).get("Ahri")).toBe("Ahri");
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, options] of vi.mocked(fetch).mock.calls) {
      expect(options?.signal?.aborted).toBe(true);
    }

    vi.mocked(fetch)
      .mockReturnValueOnce(retryVersions.promise)
      .mockResolvedValueOnce(
        Response.json({ data: { Ahri: { id: "Ahri", name: "복구된 이름" } } }),
      );
    const retry = resolveChampionNames(["Ahri"]);
    lateChampions.resolve(
      Response.json({ data: { Ahri: { id: "Ahri", name: "late" } } }),
    );
    await vi.advanceTimersByTimeAsync(0);
    const retryJoined = resolveChampionNames(["Ahri"]);
    expect(fetch).toHaveBeenCalledTimes(3);
    retryVersions.resolve(Response.json(["16.20.1"]));
    expect((await retry).get("Ahri")).toBe("복구된 이름");
    expect((await retryJoined).get("Ahri")).toBe("복구된 이름");
    expect((await resolveChampionNames(["Ahri"])).get("Ahri")).toBe(
      "복구된 이름",
    );
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([true, false])(
    "renders prototype-property names safely (service available: %s)",
    async (available) => {
      if (available) successfulFetch();
      else
        vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
      const names = ["__proto__", "constructor", "toString"];
      const parsed = parseRofl(
        replayBytes({
          players: names.map((name) => replayPlayer({ SKIN: name })),
        }),
      );
      const { resolveChampionNames } = await import("./champions");
      const result = await resolveChampionNames(
        parsed.participants.map((p) => p.champion!),
      );
      for (const name of names) {
        expect(result.get(name)).toBe(name);
        expect(
          renderToStaticMarkup(createElement("td", null, result.get(name))),
        ).toBe(`<td>${name}</td>`);
      }
    },
  );

  it.each([
    "versions headers",
    "versions body",
    "champions headers",
    "champions body",
  ])("falls back within two seconds when waiting for %s", async (phase) => {
    vi.useFakeTimers();
    const stalled = new Promise<Response>(() => {});
    const response = Response.json(
      phase.startsWith("versions") ? ["16.19.1"] : { data: {} },
    );
    if (phase.endsWith("body"))
      vi.spyOn(response, "json").mockReturnValue(new Promise(() => {}));
    if (phase.startsWith("champions")) {
      vi.mocked(fetch).mockResolvedValueOnce(Response.json(["16.19.1"]));
    }
    vi.mocked(fetch).mockReturnValueOnce(
      phase.endsWith("body") ? Promise.resolve(response) : stalled,
    );
    const { resolveChampionNames } = await import("./champions");
    const lookup = resolveChampionNames(["Ahri"]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await lookup).get("Ahri")).toBe("Ahri");
    for (const [, options] of vi.mocked(fetch).mock.calls) {
      expect(options?.signal?.aborted).toBe(true);
    }
    expect(vi.getTimerCount()).toBe(0);
    successfulFetch();
    expect((await resolveChampionNames(["Ahri"])).get("Ahri")).toBe("아리");
  });

  it("shares one deadline across both requests and does not cache a late result", async () => {
    vi.useFakeTimers();
    let resolveVersions!: (response: Response) => void;
    let resolveChampions!: (response: Response) => void;
    vi.mocked(fetch)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveVersions = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveChampions = resolve;
        }),
      );
    const { resolveChampionNames } = await import("./champions");
    const lookup = resolveChampionNames(["Ahri"]);
    await vi.advanceTimersByTimeAsync(1_500);
    resolveVersions(Response.json(["16.19.1"]));
    await vi.advanceTimersByTimeAsync(500);
    expect((await lookup).get("Ahri")).toBe("Ahri");
    resolveChampions(
      Response.json({ data: { Ahri: { id: "Ahri", name: "late" } } }),
    );
    await vi.advanceTimersByTimeAsync(0);
    successfulFetch();
    expect((await resolveChampionNames(["Ahri"])).get("Ahri")).toBe("아리");
    expect(vi.getTimerCount()).toBe(0);
  });
});
