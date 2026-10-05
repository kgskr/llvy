import type { NicknameSuggestion } from "@/lib/nickname-search";

type Callbacks = {
  onLoading: () => void;
  onSuggestions: (suggestions: NicknameSuggestion[]) => void;
  onError: () => void;
  onUnauthorized: () => void;
};

/** Each input owns its request; cancellation also suppresses ignored-abort responses. */
export function scheduleNicknameAutocomplete(
  input: string,
  callbacks: Callbacks,
  fetcher: typeof fetch = fetch,
): () => void {
  const controller = new AbortController();
  if (!input.trim()) return () => controller.abort();
  const timer = setTimeout(async () => {
    if (controller.signal.aborted) return;
    callbacks.onLoading();
    try {
      const query = new URLSearchParams({ nickname: input });
      const response = await fetcher(`/api/search/autocomplete?${query}`, {
        signal: controller.signal,
        cache: "no-store",
        credentials: "same-origin",
      });
      if (controller.signal.aborted) return;
      if (response.status === 401) {
        callbacks.onUnauthorized();
        return;
      }
      if (!response.ok) throw new Error("Autocomplete unavailable");
      const body: unknown = await response.json();
      if (controller.signal.aborted) return;
      const suggestions =
        body && typeof body === "object" && "suggestions" in body
          ? body.suggestions
          : null;
      if (!Array.isArray(suggestions)) throw new Error("Invalid suggestions");
      const safe: NicknameSuggestion[] = [];
      for (const entry of suggestions.slice(0, 10)) {
        if (
          !entry ||
          typeof entry.id !== "string" ||
          typeof entry.gameName !== "string" ||
          typeof entry.tagLine !== "string"
        )
          throw new Error("Invalid suggestion");
        safe.push({
          id: entry.id,
          gameName: entry.gameName,
          tagLine: entry.tagLine,
        });
      }
      callbacks.onSuggestions(safe);
    } catch {
      if (!controller.signal.aborted) callbacks.onError();
    }
  }, 200);
  return () => {
    clearTimeout(timer);
    controller.abort();
  };
}

export function nextSuggestionIndex(
  current: number,
  count: number,
  direction: "up" | "down",
) {
  if (count === 0) return -1;
  if (current < 0) return direction === "down" ? 0 : count - 1;
  return (current + (direction === "down" ? 1 : -1) + count) % count;
}

export function nicknameSearchHref(nickname: string): string {
  return `/search?${new URLSearchParams({ nickname })}`;
}
