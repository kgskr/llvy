import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  nextSuggestionIndex,
  nicknameSearchHref,
  scheduleNicknameAutocomplete,
} from "./nickname-autocomplete-client";

function callbacks() {
  return {
    onLoading: vi.fn(),
    onSuggestions: vi.fn(),
    onError: vi.fn(),
    onUnauthorized: vi.fn(),
  };
}
function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const SUGGESTION = { id: "account", gameName: "한글닉네임", tagLine: "KR1" };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("nickname autocomplete request lifecycle", () => {
  it("debounces for 200ms and aborts replaced inputs before they send requests", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ suggestions: [SUGGESTION] }));
    const first = callbacks();
    const cancel = scheduleNicknameAutocomplete("한", first, fetcher);
    await vi.advanceTimersByTimeAsync(199);
    expect(fetcher).not.toHaveBeenCalled();
    cancel();
    const current = callbacks();
    scheduleNicknameAutocomplete("한글", current, fetcher);
    await vi.advanceTimersByTimeAsync(200);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "/api/search/autocomplete?nickname=%ED%95%9C%EA%B8%80",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(first.onSuggestions).not.toHaveBeenCalled();
    expect(current.onSuggestions).toHaveBeenCalledWith([SUGGESTION]);
  });

  it("aborts in-flight requests and ignores late responses even when fetch ignores the abort signal", async () => {
    const old = deferredResponse();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(Response.json({ suggestions: [SUGGESTION] }));
    const obsolete = callbacks();
    const cancel = scheduleNicknameAutocomplete("old", obsolete, fetcher);
    await vi.advanceTimersByTimeAsync(200);
    const signal = fetcher.mock.calls[0][1]!.signal!;
    cancel();
    expect(signal.aborted).toBe(true);
    const current = callbacks();
    scheduleNicknameAutocomplete("current", current, fetcher);
    await vi.advanceTimersByTimeAsync(200);
    old.resolve(
      Response.json({ suggestions: [{ ...SUGGESTION, gameName: "obsolete" }] }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(obsolete.onSuggestions).not.toHaveBeenCalled();
    expect(obsolete.onError).not.toHaveBeenCalled();
    expect(current.onSuggestions).toHaveBeenCalledWith([SUGGESTION]);
  });

  it("cancels responses that arrive while JSON decoding is still pending", async () => {
    let resolveBody!: (value: unknown) => void;
    const body = new Promise((resolve) => {
      resolveBody = resolve;
    });
    const response = { ok: true, status: 200, json: () => body } as Response;
    const handlers = callbacks();
    const cancel = scheduleNicknameAutocomplete(
      "prefix",
      handlers,
      vi.fn<typeof fetch>().mockResolvedValue(response),
    );
    await vi.advanceTimersByTimeAsync(200);
    cancel();
    resolveBody({ suggestions: [SUGGESTION] });
    await vi.advanceTimersByTimeAsync(0);
    expect(handlers.onSuggestions).not.toHaveBeenCalled();
  });

  it("does not query blank input", async () => {
    const fetcher = vi.fn<typeof fetch>();
    scheduleNicknameAutocomplete("  ", callbacks(), fetcher);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("distinguishes session expiry from lookup failure", async () => {
    const expired = callbacks();
    scheduleNicknameAutocomplete(
      "test",
      expired,
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 401 })),
    );
    const failed = callbacks();
    scheduleNicknameAutocomplete(
      "test",
      failed,
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 500 })),
    );
    await vi.advanceTimersByTimeAsync(200);
    expect(expired.onUnauthorized).toHaveBeenCalledOnce();
    expect(expired.onError).not.toHaveBeenCalled();
    expect(failed.onError).toHaveBeenCalledOnce();
    expect(failed.onSuggestions).not.toHaveBeenCalled();
  });
});

describe("keyboard selection and search navigation", () => {
  it("opens at the first/last item and wraps arrow selection without an invalid index", () => {
    expect(nextSuggestionIndex(-1, 3, "down")).toBe(0);
    expect(nextSuggestionIndex(-1, 3, "up")).toBe(2);
    expect(nextSuggestionIndex(2, 3, "down")).toBe(0);
    expect(nextSuggestionIndex(0, 3, "up")).toBe(2);
    expect(nextSuggestionIndex(-1, 0, "down")).toBe(-1);
  });

  it("encodes tags, spaces and URL-like nicknames as a local search query", () => {
    const href = nicknameSearchHref("javascript:alert(1)#한 글");
    expect(href.startsWith("/search?")).toBe(true);
    expect(
      new URL(href, "https://llvy.invalid").searchParams.get("nickname"),
    ).toBe("javascript:alert(1)#한 글");
  });
});
