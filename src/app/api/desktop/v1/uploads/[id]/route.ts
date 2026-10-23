import { uploadStatus } from "@/lib/desktop/upload-store";
import { device, endpoint } from "@/lib/desktop/http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () =>
    uploadStatus(await device(request), (await context.params).id),
  );
}
