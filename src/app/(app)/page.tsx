import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { NicknameSearchForm } from "./nickname-search-form";

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "viewer") redirect("/games");

  return (
    <section className="search-landing" aria-labelledby="search-landing-title">
      <h1 id="search-landing-title">LLVY</h1>
      <p className="search-landing-description">
        함께한 게임을 롤 닉네임으로 찾아보세요.
      </p>
      <NicknameSearchForm />
    </section>
  );
}
