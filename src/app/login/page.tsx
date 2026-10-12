import { LoginForm } from "./login-form";

const MESSAGES: Record<string, string> = {
  membership: "지정된 Discord 서버의 멤버만 이용할 수 있습니다.",
  cancelled: "Discord 로그인이 취소되었습니다.",
  invalid: "로그인 요청이 만료되었거나 올바르지 않습니다. 다시 로그인하세요.",
  unavailable:
    "Discord 가입 여부를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  configuration: "로그인 설정에 문제가 있습니다. 운영자에게 문의하세요.",
  throttled: "시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string; error?: string }>;
}) {
  const { redirectTo, error } = await searchParams;

  return (
    <main className="app-shell">
      <section className="login-card">
        <p className="eyebrow">LLVY</p>
        <h1 className="login-title">내전 전적 보관소</h1>
        <p className="summary">Discord 계정으로 입장하세요.</p>
        {typeof error === "string" && Object.hasOwn(MESSAGES, error) ? (
          <p className="form-error" role="alert">
            {MESSAGES[error]}
          </p>
        ) : null}
        <LoginForm redirectTo={redirectTo ?? "/"} />
      </section>
    </main>
  );
}
