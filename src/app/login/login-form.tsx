"use client";

import { useActionState } from "react";

import { login, type LoginState } from "./actions";

export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    login,
    null,
  );

  return (
    <form action={formAction} className="login-form">
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <label htmlFor="password">공유 비밀번호</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        autoFocus
        required
      />
      {state?.error ? (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? "확인 중…" : "입장"}
      </button>
    </form>
  );
}
