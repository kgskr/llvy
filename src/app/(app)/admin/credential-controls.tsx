"use client";

import { useActionState, useId, useState } from "react";

import {
  grantAdminAction,
  revokeAdminAction,
  type OwnerActionState,
} from "./owner-actions";

export function CredentialControls({
  memberId,
  memberName,
  administrator,
}: {
  memberId: string;
  memberName: string;
  administrator: boolean;
}) {
  const keyId = useId();
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState<
    OwnerActionState,
    FormData
  >(async (previousState, formData) => {
    setIssuedKey(null);
    setCopyMessage(null);
    try {
      const action =
        formData.get("operation") === "revoke"
          ? revokeAdminAction
          : grantAdminAction;
      const nextState = await action(previousState, formData);
      if (nextState.status === "success" && nextState.key) {
        setIssuedKey(nextState.key);
      }
      // The Action state never retains plaintext that could be redisplayed
      // after the owner closes the one-time display.
      return {
        status: nextState.status,
        message: nextState.message,
        administrator: nextState.administrator,
      };
    } catch {
      return {
        status: "error",
        message:
          "처리 결과를 확인하지 못했습니다. 목록을 새로고침하세요. 비밀키를 받지 못했다면 지정 취소 후 다시 지정하세요.",
      };
    }
  }, null);
  const isAdministrator = state?.administrator ?? administrator;

  async function copyKey() {
    if (!issuedKey) return;
    try {
      await navigator.clipboard.writeText(issuedKey);
      setCopyMessage("비밀키를 복사했습니다.");
    } catch {
      setCopyMessage(
        "자동 복사하지 못했습니다. 비밀키를 선택해 직접 복사하세요.",
      );
    }
  }

  return (
    <div className="stack">
      <form action={formAction} className="stack">
        <input type="hidden" name="memberId" value={memberId} />
        <input
          type="hidden"
          name="operation"
          value={isAdministrator ? "revoke" : "grant"}
        />
        {isAdministrator ? (
          <span className="badge badge-muted">관리자</span>
        ) : null}
        <button
          type="submit"
          className={isAdministrator ? "button button-danger" : "button"}
          disabled={pending}
          aria-label={`${memberName} ${isAdministrator ? "관리자 지정 취소" : "관리자로 지정"}`}
        >
          {pending
            ? "처리 중…"
            : isAdministrator
              ? "지정 취소"
              : "관리자로 지정"}
        </button>
      </form>
      {state ? (
        <p
          className={state.status === "error" ? "form-error" : "form-note"}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}
      {issuedKey ? (
        <section
          className="card stack"
          aria-label={`${memberName} 관리자 비밀키`}
        >
          <div className="field">
            <label htmlFor={keyId}>발급된 관리자 비밀키</label>
            <input
              id={keyId}
              value={issuedKey}
              readOnly
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <p className="form-note">
            지금 한 번만 표시됩니다. 닫거나 새로고침하면 다시 확인할 수
            없습니다. 분실하면 지정 취소 후 다시 지정해야 합니다.
          </p>
          <button type="button" className="button" onClick={copyKey}>
            복사
          </button>
          {copyMessage ? (
            <p className="form-note" role="status">
              {copyMessage}
            </p>
          ) : null}
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setIssuedKey(null);
              setCopyMessage(null);
            }}
          >
            닫기 (다시 확인할 수 없음)
          </button>
        </section>
      ) : null}
    </div>
  );
}
