import { sessionInfo } from "@/lib/desktop/upload-store";
import { device, endpoint } from "@/lib/desktop/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return endpoint(async () => sessionInfo(await device(request)));
}
