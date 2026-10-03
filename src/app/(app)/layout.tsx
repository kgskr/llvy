import Link from "next/link";

import { logout } from "@/app/login/actions";

export default function AppLayout({ children }: { children: React.ReactNode }) {
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
          <Link href="/admin">관리</Link>
        </nav>
        <form action={logout}>
          <button type="submit" className="nav-logout">
            로그아웃
          </button>
        </form>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
