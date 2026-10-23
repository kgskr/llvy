import { canUpload, ROLE_LABELS } from "@/lib/capabilities";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  approveAuthorization,
  connectionRequest,
  listOwnDevices,
} from "@/lib/desktop/auth-store";
import { checkCsrf, csrf } from "@/lib/desktop/browser";
import { DesktopError } from "@/lib/desktop/protocol";
export const dynamic = "force-dynamic";
export default async function Connect({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const { request: id = "" } = await searchParams;
  const actor = await getSession();
  if (!actor)
    redirect(
      "/login?redirectTo=" +
        encodeURIComponent("/desktop/connect?request=" + id),
    );
  if (!canUpload(actor.role))
    return (
      <main className="container">
        <h1>연결 권한이 없습니다</h1>
        <p>업로더, 관리자 또는 서비스 오너 계정이 필요합니다.</p>
      </main>
    );
  let request;
  try {
    request = await connectionRequest(actor, id);
  } catch (error) {
    if (!(error instanceof DesktopError)) throw error;
    return (
      <main className="container">
        <h1>연결할 수 없습니다</h1>
        <p>
          요청이 만료되었거나 데스크톱 연결이 비활성화되었습니다. 앱에서 다시
          시작해 주세요.
        </p>
      </main>
    );
  }
  const devices = (await listOwnDevices(actor)).filter((d) => d.active);
  const action = "connect:" + id;
  async function submit(form: FormData) {
    "use server";
    const current = await getSession();
    if (!current) redirect("/login");
    await checkCsrf(current, action, form.get("csrf"));
    const decision = form.get("decision");
    if (decision !== "approve" && decision !== "deny")
      throw new DesktopError("invalid_request");
    const replacement = form.get("replacement");
    const callback = await approveAuthorization(
      current,
      id,
      decision,
      typeof replacement === "string" && replacement ? replacement : undefined,
    );
    redirect(callback ?? "/desktop/devices");
  }
  return (
    <main className="container">
      <h1>LLVY 업로더 연결</h1>
      <p>
        {actor.name} · {ROLE_LABELS[actor.role]}
      </p>
      <p>리플레이 업로드 및 이 기기의 업로드 결과 조회를 허용합니다.</p>
      <p>
        {request.mode === "persistent"
          ? "로그인 유지 · 최대 30일"
          : "임시 연결 · 최대 12시간"}
      </p>
      <p>
        본인이 앱에서 시작한 요청인지 확인해 주세요. 활성 연결: {devices.length}
        /5
      </p>
      <form action={submit}>
        <input type="hidden" name="csrf" value={csrf(actor, action)} />
        <label>
          교체할 임시 연결
          <select name="replacement" defaultValue="">
            <option value="">교체하지 않음</option>
            {devices
              .filter((d) => d.mode === "transient")
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {d.createdAt.toISOString()}
                </option>
              ))}
          </select>
        </label>
        <button name="decision" value="approve">
          연결 허용
        </button>
        <button name="decision" value="deny">
          거절
        </button>
      </form>
      <Link href="/desktop/devices">연결된 기기 관리</Link>
    </main>
  );
}
