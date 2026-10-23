import { reserveUpload } from "@/lib/desktop/upload-store";
import { body, device, endpoint } from "@/lib/desktop/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return endpoint(async () => {
    const actor = await device(request);
    return reserveUpload(
      actor,
      await body(request),
      request.headers.get("idempotency-key") ?? "",
    );
  }, 201);
}
