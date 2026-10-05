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
        <p className="summary">입장은 관리자 문의.</p>
        <LoginForm redirectTo={redirectTo ?? "/"} />
      </section>
    </main>
  );
}
