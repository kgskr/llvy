"use client";

import {
  createContext,
  useActionState,
  useContext,
  useId,
  useState,
} from "react";
import { MEMBER_NAME_MAX_LENGTH, MIN_BIRTH_YEAR } from "@/lib/validation";
import {
  createMemberAction,
  linkAccountAction,
  unlinkAccountAction,
  updateMemberAction,
  type AdminActionState,
} from "./actions";

const NoticeContext = createContext<((state: AdminActionState) => void) | null>(
  null,
);

/** Keep feedback visible when an account or deleted member leaves the table. */
export function AdminFeedbackProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [notice, setNotice] = useState<AdminActionState>(null);
  return (
    <NoticeContext.Provider value={setNotice}>
      <Feedback state={notice} />
      {children}
    </NoticeContext.Provider>
  );
}

function Feedback({ state }: { state: AdminActionState }) {
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

export function MemberForm({
  member,
  currentYear,
}: {
  member?: { id: string; name: string; birthYear: number | null };
  currentYear: number;
}) {
  const fieldId = useId();
  const [name, setName] = useState(member?.name ?? "");
  const [birthYear, setBirthYear] = useState(
    member?.birthYear?.toString() ?? "",
  );
  const [state, formAction, pending] = useActionState<
    AdminActionState,
    FormData
  >(async (previousState, formData) => {
    const action = member ? updateMemberAction : createMemberAction;
    const nextState = await action(previousState, formData);
    if (nextState?.status === "success" && !member) {
      setName("");
      setBirthYear("");
    }
    return nextState;
  }, null);

  return (
    <form action={formAction} className="stack">
      {member ? (
        <input type="hidden" name="memberId" value={member.id} />
      ) : null}
      <div className="field">
        <label htmlFor={`${fieldId}-name`}>이름</label>
        <input
          id={`${fieldId}-name`}
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={MEMBER_NAME_MAX_LENGTH}
          required
          disabled={pending}
        />
      </div>
      <div className="field">
        <label htmlFor={`${fieldId}-year`}>생년 (선택)</label>
        <input
          id={`${fieldId}-year`}
          name="birthYear"
          type="number"
          inputMode="numeric"
          min={MIN_BIRTH_YEAR}
          max={currentYear}
          step="1"
          placeholder="예: 1995"
          value={birthYear}
          onChange={(event) => setBirthYear(event.target.value)}
          disabled={pending}
        />
      </div>
      <button type="submit" className="button" disabled={pending}>
        {pending ? "저장 중…" : member ? "수정 저장" : "추가"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function LinkAccountForm({
  accountId,
  accountName,
  members,
}: {
  accountId: string;
  accountName: string;
  members: { id: string; name: string }[];
}) {
  const notify = useContext(NoticeContext);
  const [state, formAction, pending] = useActionState<
    AdminActionState,
    FormData
  >(async (previousState, formData) => {
    notify?.(null);
    const nextState = await linkAccountAction(previousState, formData);
    if (nextState?.status === "success") notify?.(nextState);
    return nextState;
  }, null);
  return (
    <form action={formAction} className="link-form">
      <input type="hidden" name="accountId" value={accountId} />
      <select
        name="memberId"
        defaultValue=""
        aria-label={`${accountName} 계정을 연결할 모임원`}
        required
        disabled={pending}
      >
        <option value="" disabled>
          모임원 선택…
        </option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </select>
      <button type="submit" className="button" disabled={pending}>
        {pending ? "연결 중…" : "연결"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function UnlinkAccountForm({
  accountId,
  accountName,
}: {
  accountId: string;
  accountName: string;
}) {
  const notify = useContext(NoticeContext);
  const [state, formAction, pending] = useActionState<
    AdminActionState,
    FormData
  >(async (previousState, formData) => {
    notify?.(null);
    const nextState = await unlinkAccountAction(previousState, formData);
    if (nextState?.status === "success") notify?.(nextState);
    return nextState;
  }, null);
  return (
    <form action={formAction} style={{ display: "inline" }}>
      <input type="hidden" name="accountId" value={accountId} />
      <button
        type="submit"
        className="link-button"
        disabled={pending}
        aria-label={`${accountName} 연결 해제`}
      >
        {pending ? "해제 중…" : "연결 해제"}
      </button>
      <Feedback state={state} />
    </form>
  );
}
