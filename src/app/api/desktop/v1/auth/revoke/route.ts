import { revokeOwnAccess } from "@/lib/desktop/auth-store";
import { bearer, endpoint } from "@/lib/desktop/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return endpoint(async () => {
    await revokeOwnAccess(bearer(request));
    return { ok: true };
  });
}
