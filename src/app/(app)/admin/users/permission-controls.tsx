"use client";
import { useActionState } from "react";
import {
  grantAdminAction,
  revokeAdminAction,
  type OwnerActionState,
} from "../owner-actions";
export function PermissionControls({
  accountId,
  administrator,
  suspended,
}: {
  accountId: string;
  administrator: boolean;
  suspended: boolean;
}) {
  const [state, action, pending] = useActionState<OwnerActionState, FormData>(
    administrator ? revokeAdminAction : grantAdminAction,
    null,
  );
  return (
    <form action={action} className="stack">
      <input type="hidden" name="accountId" value={accountId} />
      <button
        type="submit"
        className="button button-secondary"
        disabled={pending || (suspended && !administrator)}
      >
        {pending
          ? "처리 중…"
          : administrator
            ? "관리자 지정 취소"
            : "관리자로 지정"}
      </button>
      {state ? (
        <p
          role="status"
          className={state.status === "error" ? "form-error" : "form-note"}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
