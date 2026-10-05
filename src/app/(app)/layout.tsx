import Link from "next/link";
import { redirect } from "next/navigation";

import { logout } from "@/app/login/actions";
import { getSession } from "@/lib/session";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <div className="app-shell">
      <header className="nav">
        <Link href="/" className="nav-brand">
          LLVY
        </Link>
        <nav className="nav-links">
          <Link href="/upload">업로드</Link>
          <Link href="/games">게임</Link>
          <Link href="/members">모임원</Link>
          {session?.role === "admin" ? <Link href="/admin">관리</Link> : null}
        </nav>
        <form action={logout}>
          <span className="muted">
            {session?.role === "admin" ? "관리자" : "업로더"}
          </span>{" "}
          <button type="submit" className="nav-logout">
            로그아웃
          </button>
        </form>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
