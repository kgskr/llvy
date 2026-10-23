import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listOwnDevices, revokeOwnDevice } from "@/lib/desktop/auth-store";
import { checkCsrf, csrf } from "@/lib/desktop/browser";
export const dynamic = "force-dynamic";
export default async function Devices() {
  const actor = await getSession();
  if (!actor) redirect("/login?redirectTo=%2Fdesktop%2Fdevices");
  const devices = await listOwnDevices(actor);
  async function revoke(form: FormData) {
    "use server";
    const current = await getSession();
    if (!current) redirect("/login");
    await checkCsrf(current, "devices", form.get("csrf"));
    await revokeOwnDevice(current, String(form.get("device")));
    redirect("/desktop/devices");
  }
  return (
    <main className="container">
      <h1>연결된 기기</h1>
      <p>
        {actor.name} 계정의 업로더 연결입니다. 브라우저 로그인과 별도로 해제할
        수 있습니다.
      </p>
      {devices.length === 0 ? (
        <p>연결된 기기가 없습니다.</p>
      ) : (
        <ul>
          {devices.map((d) => (
            <li key={d.id}>
              <p>
                {d.name} ·{" "}
                {d.mode === "persistent" ? "로그인 유지" : "임시 연결"} · 만료{" "}
                {d.expiresAt.toISOString()}
              </p>
              {!d.active ? (
                <p>해제 또는 만료됨</p>
              ) : (
                <form action={revoke}>
                  <input
                    type="hidden"
                    name="csrf"
                    value={csrf(actor, "devices")}
                  />
                  <input type="hidden" name="device" value={d.id} />
                  <button>연결 해제</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
