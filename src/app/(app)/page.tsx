import { redirect } from "next/navigation";
import { getReadSession } from "@/lib/session";
import { NicknameSearchForm } from "./nickname-search-form";

export default async function HomePage() {
  const session = await getReadSession();
  if (!session) redirect("/login");

  return (
    <section className="search-landing" aria-labelledby="search-landing-title">
      <h1 id="search-landing-title">LLVY</h1>
      <p className="search-landing-description">
        모임원 이름이나 롤 닉네임으로 전적을 찾아보세요.
      </p>
      <NicknameSearchForm />
    </section>
  );
}
