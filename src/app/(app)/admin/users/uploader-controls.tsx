"use client";

import { useActionState } from "react";
import { grantUploaderAction, revokeUploaderAction } from "./uploader-actions";

export function UploaderControls({
  accountId,
  uploader,
  suspended,
}: {
  accountId: string;
  uploader: boolean;
  suspended: boolean;
}) {
  const [state, action, pending] = useActionState(
    uploader ? revokeUploaderAction : grantUploaderAction,
    null,
  );
  return (
    <form action={action} className="stack">
      <input type="hidden" name="accountId" value={accountId} />
      <button type="submit" disabled={pending || (suspended && !uploader)}>
        {pending
          ? "처리 중…"
          : uploader
            ? "업로더 권한 회수"
            : "업로더 권한 부여"}
      </button>
      {state ? (
        <p
          role="status"
          className={state.status === "error" ? "error" : "muted"}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
