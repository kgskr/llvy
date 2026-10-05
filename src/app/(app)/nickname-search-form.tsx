"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { NicknameSuggestion } from "@/lib/nickname-search";
import { riotId } from "@/lib/format";
import {
  nextSuggestionIndex,
  nicknameSearchHref,
  scheduleNicknameAutocomplete,
} from "./nickname-autocomplete-client";

export function NicknameSearchForm({
  initialNickname = "",
}: {
  initialNickname?: string;
}) {
  const router = useRouter();
  const fieldId = useId();
  const listId = `${fieldId}-options`;
  const [nickname, setNickname] = useState(initialNickname);
  const [suggestions, setSuggestions] = useState<NicknameSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  const activeOption = useRef<HTMLLIElement | null>(null);
  const cancelCurrent = useRef<(() => void) | null>(null);

  useEffect(() => {
    const cancel = scheduleNicknameAutocomplete(nickname, {
      onLoading: () => setLoading(true),
      onSuggestions: (entries) => {
        setSuggestions(entries);
        setLoading(false);
        setOpen(focused.current && entries.length > 0);
      },
      onError: () => {
        setLoading(false);
        setError(
          "자동완성을 불러오지 못했습니다. 닉네임을 직접 입력해 검색하세요.",
        );
      },
      onUnauthorized: () => {
        setLoading(false);
        router.push("/login?redirectTo=%2F");
      },
    });
    cancelCurrent.current = cancel;
    return cancel;
  }, [nickname, router]);

  useEffect(() => {
    if (open && activeIndex >= 0)
      activeOption.current?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function selectSuggestion(suggestion: NicknameSuggestion) {
    cancelCurrent.current?.();
    focused.current = false;
    setOpen(false);
    setActiveIndex(-1);
    setLoading(false);
    const value = riotId(suggestion.gameName, suggestion.tagLine);
    setNickname(value);
    router.push(nicknameSearchHref(value));
  }

  const expanded = open && suggestions.length > 0;
  return (
    <form
      action="/search"
      method="get"
      className="nickname-search-form"
      role="search"
      aria-label="롤 닉네임 검색"
      onSubmit={(event) => {
        if (!nickname.trim()) event.preventDefault();
        cancelCurrent.current?.();
        setOpen(false);
        setLoading(false);
      }}
    >
      <div className="nickname-search-control">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx="10.5"
            cy="10.5"
            r="6.5"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="m15.5 15.5 4.5 4.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        <label htmlFor={fieldId} className="sr-only">
          롤 닉네임
        </label>
        <input
          id={fieldId}
          name="nickname"
          type="search"
          required
          role="combobox"
          value={nickname}
          placeholder="롤 닉네임#태그를 입력하세요"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={
            expanded && activeIndex >= 0
              ? `${listId}-${activeIndex}`
              : undefined
          }
          aria-describedby={`${fieldId}-note`}
          onFocus={() => {
            focused.current = true;
            setOpen(suggestions.length > 0);
          }}
          onBlur={() => {
            focused.current = false;
            setOpen(false);
            setActiveIndex(-1);
          }}
          onChange={(event) => {
            cancelCurrent.current?.();
            setNickname(event.target.value);
            setSuggestions([]);
            setActiveIndex(-1);
            setOpen(false);
            setLoading(false);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (
              (event.key === "ArrowDown" || event.key === "ArrowUp") &&
              suggestions.length > 0
            ) {
              event.preventDefault();
              setOpen(true);
              setActiveIndex(
                nextSuggestionIndex(
                  activeIndex,
                  suggestions.length,
                  event.key === "ArrowDown" ? "down" : "up",
                ),
              );
            } else if (event.key === "Enter" && expanded && activeIndex >= 0) {
              event.preventDefault();
              selectSuggestion(suggestions[activeIndex]);
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancelCurrent.current?.();
              setOpen(false);
              setActiveIndex(-1);
              setLoading(false);
            }
          }}
        />
        <button type="submit">검색</button>
      </div>
      {expanded ? (
        <ul
          id={listId}
          className="nickname-suggestions"
          role="listbox"
          aria-label="저장된 롤 닉네임"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.id}
              id={`${listId}-${index}`}
              role="option"
              ref={activeIndex === index ? activeOption : undefined}
              aria-selected={activeIndex === index}
              onPointerDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectSuggestion(suggestion)}
            >
              {riotId(suggestion.gameName, suggestion.tagLine)}
            </li>
          ))}
        </ul>
      ) : null}
      <p
        id={`${fieldId}-note`}
        className={error ? "form-error" : "search-landing-note"}
        role="status"
        aria-live="polite"
      >
        {error ??
          (loading
            ? "닉네임을 찾는 중…"
            : "저장된 게임에 연결된 모임원의 롤 닉네임을 검색하세요.")}
      </p>
    </form>
  );
}
