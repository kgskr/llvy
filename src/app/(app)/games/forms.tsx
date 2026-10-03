"use client";

import {
  createContext,
  useActionState,
  useContext,
  useId,
  useState,
} from "react";

import { MIN_GAME_DATE_INPUT } from "@/lib/game-date";

import {
  restoreGameDateAction,
  setGameExcludedAction,
  updateGameDateAction,
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
          <label htmlFor={fieldId}>경기 날짜·시간 (한국 시간, UTC+09:00)</label>
          <input
            id={fieldId}
            name="playedAt"
            type="datetime-local"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            min={MIN_GAME_DATE_INPUT}
            step="60"
            required
            disabled={busy}
            aria-describedby={`${fieldId}-note`}
          />
          <p id={`${fieldId}-note`} className="form-note">
            2009년 이후부터 현재 기준 24시간 이내의 날짜를 입력하세요. 원본
            시각은 보존됩니다.
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
