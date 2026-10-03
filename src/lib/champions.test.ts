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

function successfulFetch() {
  vi.mocked(fetch)
    .mockResolvedValueOnce(Response.json(["16.19.1"]))
    .mockResolvedValueOnce(
      Response.json({
        data: {
          Ahri: { id: "Ahri", name: "아리" },
          Broken: { id: "Broken", name: { unexpected: true } },
        },
      }),
    );
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
