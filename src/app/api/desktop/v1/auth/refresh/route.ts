import { refreshAuthorization } from "@/lib/desktop/auth-store";
import { body, clientIp, endpoint } from "@/lib/desktop/http";
import { requireDesktop } from "@/lib/desktop/protocol";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return endpoint(async () => {
    requireDesktop();
    return refreshAuthorization(await body(request), clientIp(request));
  });
}
