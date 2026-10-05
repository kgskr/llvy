import { redirect } from "next/navigation";
import { assertSession } from "@/lib/session";
import { UnauthorizedError } from "@/lib/auth-errors";
import { NicknameSearchForm } from "../../nickname-search-form";

export const dynamic = "force-dynamic";

export default async function MissingNicknamePage() {
  try {
    await assertSession();
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect("/login");
    throw error;
  }
  return (
    <section className="stack">
      <div>
        <h1>없는 사용자입니다</h1>
        <p className="muted">
          저장된 게임에서 이 닉네임과 연결된 모임원을 찾지 못했습니다. 닉네임과
          태그를 확인해 다시 검색하세요.
        </p>
      </div>
      <NicknameSearchForm />
    </section>
  );
}
