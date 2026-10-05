import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "viewer") redirect("/games");
  return (
    <section className="stack">
      <h1>LLVY</h1>
      <p>함께한 게임과 모임원 전적을 확인하세요.</p>
      <div className="cta-row">
        <Link href="/games">게임</Link>
        <Link href="/members">모임원</Link>
      </div>
    </section>
  );
}
