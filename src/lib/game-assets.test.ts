import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  vi.mocked(fetch).mockImplementation(async (input) => {
    const path = String(input);
    if (path.endsWith("versions.json"))
      return Response.json(["16.20.1", "16.19.2", "16.19.1"]);
    return Response.json({
      data: path.endsWith("champion.json")
        ? {
            Fiddlesticks: {
              id: "Fiddlesticks",
              name: "피들스틱",
              image: { full: "Fiddlesticks.png" },
            },
            Malformed: {
              id: "Malformed",
              name: "bad",
              image: { full: "../../bad.png" },
            },
          }
        : {
            "3158": {
              name: "명석함의 아이오니아 장화",
              image: { full: "3158.png" },
            },
            "3340": { name: "투명 와드", image: { full: "3340.png" } },
            "999": {
              name: "bad",
              image: { full: "https://example.org/item.png" },
            },
          },
    });
  });
}

describe("game detail assets", () => {
  it("bounds retained catalogs and evicts the oldest completed entry", async () => {
    const versions = Array.from({ length: 9 }, (_, i) => `16.${i + 1}.1`);
    vi.mocked(fetch).mockImplementation(async (input) =>
      Response.json(
        String(input).endsWith("versions.json")
          ? versions
          : {
              data: String(input).endsWith("champion.json")
                ? {
                    Ahri: {
                      id: "Ahri",
                      name: "아리",
                      image: { full: "Ahri.png" },
                    },
                  }
                : { "3158": { name: "장화", image: { full: "3158.png" } } },
            },
      ),
    );
    const { resolveGameAssets } = await import("./game-assets");
    for (const version of versions)
      await resolveGameAssets(version, [], [3158]);
    expect(fetch).toHaveBeenCalledTimes(27);
    await resolveGameAssets(versions[0], [], [3158]);
    expect(fetch).toHaveBeenCalledTimes(30);
  });

  it("selects the recorded patch, matches champion case and projects validated requested assets", async () => {
    successfulFetch();
    const { resolveGameAssets } = await import("./game-assets");
    const result = await resolveGameAssets(
      "16.19.821.7343",
      ["FiddleSticks", "Unknown", "Malformed"],
      [3158, 0, null, 999],
    );
    expect([...result.champions]).toEqual([
      [
        "FiddleSticks",
        {
          name: "피들스틱",
          iconUrl:
            "https://ddragon.leagueoflegends.com/cdn/16.19.2/img/champion/Fiddlesticks.png",
        },
      ],
    ]);
    expect([...result.items.keys()]).toEqual([3158]);
    expect(result.items.get(3158)?.iconUrl).toContain(
      "/16.19.2/img/item/3158.png",
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("uses latest only without a recorded version and does not guess a missing or malformed patch", async () => {
    successfulFetch();
    const { resolveGameAssets } = await import("./game-assets");
    expect(
      (await resolveGameAssets(null, ["Fiddlesticks"], [])).champions.get(
        "Fiddlesticks",
      )?.iconUrl,
    ).toContain("/16.20.1/");
    expect(
      (await resolveGameAssets("1.2.3", ["Fiddlesticks"], [])).champions.size,
    ).toBe(0);
    vi.mocked(fetch).mockClear();
    expect((await resolveGameAssets("../../16.19", [], [])).items.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("coalesces lookups, isolates returned objects and expires at 24 hours", async () => {
    vi.useFakeTimers();
    successfulFetch();
    const { resolveGameAssets } = await import("./game-assets");
    const get = () => resolveGameAssets("16.19.1.1", ["Fiddlesticks"], [3158]);
    const [a, b] = await Promise.all([get(), get()]);
    expect(fetch).toHaveBeenCalledTimes(3);
    a.items.get(3158)!.name = "mutated";
    expect(b.items.get(3158)?.name).not.toBe("mutated");
    await vi.advanceTimersByTimeAsync(86_400_000 - 1);
    await get();
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await get();
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["headers", "body"])(
    "bounds a stalled %s and ignores late results during recovery",
    async (phase) => {
      vi.useFakeTimers();
      let release!: (value: Response) => void;
      const stalled = new Promise<Response>((resolve) => {
        release = resolve;
      });
      if (phase === "headers") vi.mocked(fetch).mockReturnValueOnce(stalled);
      else
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: true,
          json: () => stalled.then(() => ["16.19.1"]),
        } as Response);
      const { resolveGameAssets } = await import("./game-assets");
      const pending = resolveGameAssets(null, ["Fiddlesticks"], [3158]);
      await vi.advanceTimersByTimeAsync(2_000);
      expect((await pending).items.size).toBe(0);
      successfulFetch();
      const retry = resolveGameAssets(null, ["Fiddlesticks"], [3158]);
      release(Response.json(["16.19.1"]));
      const result = await retry;
      expect(result.items.get(3158)?.iconUrl).toContain("/16.20.1/");
      expect(
        (await resolveGameAssets(null, [], [3158])).items.get(3158),
      ).toEqual(result.items.get(3158));
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["http", "invalid", "empty"])(
    "retries after a failed %s response",
    async (kind) => {
      vi.mocked(fetch).mockResolvedValue(
        kind === "http"
          ? new Response(null, { status: 503 })
          : Response.json(kind === "empty" ? [] : {}),
      );
      const { resolveGameAssets } = await import("./game-assets");
      expect((await resolveGameAssets(null, [], [3158])).items.size).toBe(0);
      successfulFetch();
      expect((await resolveGameAssets(null, [], [3158])).items.size).toBe(1);
    },
  );
});
