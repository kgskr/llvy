import Link from "next/link";

export default function AppNotFound() {
  return (
    <section className="card stack">
      <h1>찾을 수 없음</h1>
      <p className="muted">요청하신 페이지나 게임을 찾을 수 없습니다.</p>
      <div>
        <Link href="/games" className="button">
          게임 목록으로
        </Link>
      </div>
    </section>
  );
}
