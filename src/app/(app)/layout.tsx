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
  const isAdmin = session.role !== "viewer";
  const roleLabel = {
    viewer: "일반 사용자",
    admin: "관리자",
    owner: "서비스 오너",
  }[session.role];
  return (
    <div className="app-shell">
      <header className="nav">
        <Link href="/" className="nav-brand">
          LLVY
        </Link>
        <nav className="nav-links">
          {isAdmin ? <Link href="/upload">업로드</Link> : null}
          <Link href="/games">게임</Link>
          <Link href="/members">모임원</Link>
          {isAdmin ? <Link href="/admin">관리</Link> : null}
        </nav>
        <form action={logout}>
          <span className="muted">{roleLabel}</span>{" "}
          <button type="submit" className="nav-logout">
            로그아웃
          </button>
        </form>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
