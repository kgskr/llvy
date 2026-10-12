"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { SearchSuggestion } from "@/lib/search-contract";
import { riotId } from "@/lib/format";
import {
  nextSuggestionIndex,
  suggestionHref,
  scheduleNicknameAutocomplete,
} from "./nickname-autocomplete-client";

export function NicknameSearchForm({
  initialQuery = "",
}: {
  initialQuery?: string;
}) {
  const router = useRouter();
  const fieldId = useId();
  const listId = `${fieldId}-options`;
  const [nickname, setNickname] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const composing = useRef(false);
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
          "자동완성을 불러오지 못했습니다. 이름이나 닉네임을 직접 입력해 검색하세요.",
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

  function selectSuggestion(suggestion: SearchSuggestion) {
    cancelCurrent.current?.();
    focused.current = false;
    setOpen(false);
    setActiveIndex(-1);
    setLoading(false);
    const value =
      suggestion.kind === "member"
        ? suggestion.name
        : riotId(suggestion.gameName, suggestion.tagLine);
    setNickname(value);
    router.push(suggestionHref(suggestion));
  }

  const expanded = open && suggestions.length > 0;
  return (
    <form
      action="/search"
      method="get"
      className="nickname-search-form"
      role="search"
      aria-label="모임원 이름 또는 롤 닉네임 검색"
      onSubmit={(event) => {
        if (!nickname.trim() || composing.current) event.preventDefault();
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
          모임원 이름 또는 롤 닉네임 검색
        </label>
        <input
          id={fieldId}
          name="q"
          type="search"
          required
          role="combobox"
          value={nickname}
          placeholder="모임원 이름 또는 롤 닉네임#태그를 입력하세요"
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
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            if (
              composing.current ||
              event.nativeEvent.isComposing ||
              event.keyCode === 229
            ) {
              if (event.key === "Enter") event.preventDefault();
              return;
            }
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
          aria-label="모임원 이름과 롤 닉네임 추천"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={`${suggestion.kind}:${suggestion.id}`}
              id={`${listId}-${index}`}
              role="option"
              ref={activeIndex === index ? activeOption : undefined}
              aria-selected={activeIndex === index}
              onPointerDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectSuggestion(suggestion)}
            >
              {suggestion.kind === "member" ? (
                <>
                  <span>
                    <strong>{suggestion.name}</strong>{" "}
                    <small className="muted">모임원</small>
                  </span>
                  <small className="table-note">
                    {suggestion.accounts.length
                      ? suggestion.accounts
                          .map((account) =>
                            riotId(account.gameName, account.tagLine),
                          )
                          .join(" · ")
                      : "연결된 계정 없음"}
                  </small>
                </>
              ) : (
                <span>
                  {riotId(suggestion.gameName, suggestion.tagLine)}{" "}
                  <small className="muted">라이엇 계정</small>
                </span>
              )}
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
            ? "이름과 닉네임을 찾는 중…"
            : "모임원 이름이나 저장된 게임의 롤 닉네임을 검색하세요.")}
      </p>
    </form>
  );
}
