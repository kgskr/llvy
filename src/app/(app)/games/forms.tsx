"use client";

import {
  createContext,
  useActionState,
  useContext,
  useId,
  useState,
} from "react";

import { MIN_GAME_DATE_INPUT } from "@/lib/game-date";
import { MAX_GAME_COMMENT_LENGTH } from "@/lib/game-comment";

import {
  restoreGameDateAction,
  setGameExcludedAction,
  updateGameDateAction,
  updateGameCommentAction,
  type GameActionState,
} from "./actions";

const NoticeContext = createContext<((state: GameActionState) => void) | null>(
  null,
);

function Feedback({ state }: { state: GameActionState }) {
  if (!state) return null;
  return (
    <p
      className={state.status === "error" ? "form-error" : "form-note"}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}

/** The notice survives when restoring removes a row from the excluded list. */
export function GameFeedbackProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [notice, setNotice] = useState<GameActionState>(null);
  return (
    <NoticeContext.Provider value={setNotice}>
      <Feedback state={notice} />
      {children}
    </NoticeContext.Provider>
  );
}

export function GameVisibilityForm({
  gameId,
  excluded,
}: {
  gameId: string;
  excluded: boolean;
}) {
  const notify = useContext(NoticeContext);
  const [state, formAction, pending] = useActionState<
    GameActionState,
    FormData
  >(async (previousState, formData) => {
    notify?.(null);
    const next = await setGameExcludedAction(previousState, formData);
    if (next?.status === "success") notify?.(next);
    return next;
  }, null);

  return (
    <form action={formAction}>
      <input type="hidden" name="gameId" value={gameId} />
      <input
        type="hidden"
        name="excluded"
        value={excluded ? "false" : "true"}
      />
      <button
        type="submit"
        className="button button-secondary"
        disabled={pending}
      >
        {pending ? "변경 중…" : excluded ? "경기 복구" : "기록에서 제외"}
      </button>
      {state?.status === "error" || !notify ? <Feedback state={state} /> : null}
    </form>
  );
}

export function GameDateForm({
  gameId,
  currentValue,
  originalValue,
  hasOverride,
}: {
  gameId: string;
  currentValue: string;
  originalValue: string;
  hasOverride: boolean;
}) {
  const fieldId = useId();
  const notify = useContext(NoticeContext);
  const [value, setValue] = useState(currentValue);
  const [state, formAction, pending] = useActionState<
    GameActionState,
    FormData
  >(async (previousState, formData) => {
    notify?.(null);
    const next = await updateGameDateAction(previousState, formData);
    if (next?.status === "success") notify?.(next);
    return next;
  }, null);
  const [restoreState, restoreAction, restoring] = useActionState<
    GameActionState,
    FormData
  >(async (previousState, formData) => {
    notify?.(null);
    const next = await restoreGameDateAction(previousState, formData);
    if (next?.status === "success") {
      setValue(originalValue);
      notify?.(next);
    }
    return next;
  }, null);
  const busy = pending || restoring;

  return (
    <div className="stack">
      <form action={formAction} className="stack">
        <input type="hidden" name="gameId" value={gameId} />
        <div className="field">
          <label htmlFor={fieldId}>경기 날짜</label>
          <input
            id={fieldId}
            name="playedAt"
            type="date"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            min={MIN_GAME_DATE_INPUT}
            required
            disabled={busy}
            aria-describedby={`${fieldId}-note`}
          />
          <p id={`${fieldId}-note`} className="form-note">
            2009년 1월 1일부터 한국 날짜 기준 내일까지 입력할 수 있습니다. 원본
            날짜는 보존됩니다.
          </p>
        </div>
        <div>
          <button type="submit" className="button" disabled={busy}>
            {pending ? "저장 중…" : "날짜 저장"}
          </button>
        </div>
        {state?.status === "error" || !notify ? (
          <Feedback state={state} />
        ) : null}
      </form>
      {hasOverride ? (
        <form action={restoreAction}>
          <input type="hidden" name="gameId" value={gameId} />
          <button
            type="submit"
            className="button button-secondary"
            disabled={busy}
          >
            {restoring ? "되돌리는 중…" : "원본 날짜로 되돌리기"}
          </button>
          {restoreState?.status === "error" || !notify ? (
            <Feedback state={restoreState} />
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

export function GameCommentForm({
  gameId,
  currentValue,
}: {
  gameId: string;
  currentValue: string | null;
}) {
  const fieldId = useId();
  const notify = useContext(NoticeContext);
  const [value, setValue] = useState(currentValue ?? "");
  const [state, formAction, pending] = useActionState<
    GameActionState,
    FormData
  >(async (previousState, formData) => {
    notify?.(null);
    const next = await updateGameCommentAction(previousState, formData);
    if (next?.status === "success") notify?.(next);
    return next;
  }, null);
  const [clearState, clearAction, clearing] = useActionState<
    GameActionState,
    FormData
  >(async (previousState, formData) => {
    notify?.(null);
    const next = await updateGameCommentAction(previousState, formData);
    if (next?.status === "success") {
      setValue("");
      notify?.(next);
    }
    return next;
  }, null);
  const busy = pending || clearing;
  const length = [...value].length;
  const tooLong = length > MAX_GAME_COMMENT_LENGTH;

  return (
    <div className="stack">
      <form action={formAction} className="stack">
        <input type="hidden" name="gameId" value={gameId} />
        <div className="field">
          <label htmlFor={fieldId}>게임 코멘트</label>
          <textarea
            id={fieldId}
            name="comment"
            rows={2}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={busy}
            aria-invalid={tooLong || undefined}
            aria-describedby={`${fieldId}-note`}
          />
          <p
            id={`${fieldId}-note`}
            className={tooLong ? "form-error" : "form-note"}
          >
            공백 포함 {length} / {MAX_GAME_COMMENT_LENGTH}자 · 비워서 저장하면
            코멘트가 지워집니다.
          </p>
        </div>
        <div>
          <button type="submit" className="button" disabled={busy || tooLong}>
            {pending ? "저장 중…" : "코멘트 저장"}
          </button>
        </div>
        {state?.status === "error" || !notify ? (
          <Feedback state={state} />
        ) : null}
      </form>
      {currentValue !== null ? (
        <form action={clearAction}>
          <input type="hidden" name="gameId" value={gameId} />
          <input type="hidden" name="comment" value="" />
          <button
            type="submit"
            className="button button-secondary"
            disabled={busy}
          >
            {clearing ? "지우는 중…" : "코멘트 지우기"}
          </button>
          {clearState?.status === "error" || !notify ? (
            <Feedback state={clearState} />
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
