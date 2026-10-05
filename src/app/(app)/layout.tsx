import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { logout } from "@/app/login/actions";
import loliveYoung from "@/assets/lolive-young.jpeg";
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
        <Link
          href="/"
          className="nav-brand"
          aria-label="LLVY 홈"
          title="메인 페이지로 이동"
        >
          <Image
            src={loliveYoung}
            alt="LoLive Young"
            width={1186}
            height={662}
            sizes="(max-width: 640px) calc(100vw - 40px), (max-width: 1028px) calc(100vw - 48px), 980px"
            loading="eager"
          />
        </Link>
        <div className="nav-toolbar">
          <span className="nav-wordmark">LLVY</span>
          <nav className="nav-links" aria-label="주 메뉴">
            {isAdmin ? <Link href="/upload">업로드</Link> : null}
            <Link href="/games">게임</Link>
            <Link href="/members">모임원</Link>
            {isAdmin ? <Link href="/admin">관리</Link> : null}
          </nav>
          <form action={logout} className="nav-account">
            <span className="nav-role">{roleLabel}</span>
            <button type="submit" className="nav-logout">
              로그아웃
            </button>
          </form>
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
