import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const { redirectTo } = await searchParams;

  return (
    <main className="app-shell">
      <section className="login-card">
        <p className="eyebrow">LLVY</p>
        <h1 className="login-title">내전 전적 보관소</h1>
        <p className="summary">
          업로더 키로 업로드와 조회를, 관리자 키로 관리 기능을 이용할 수
          있습니다.
        </p>
        <LoginForm redirectTo={redirectTo ?? "/"} />
      </section>
    </main>
  );
}
