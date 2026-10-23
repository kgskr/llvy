import { authorizeTransfer } from "@/lib/desktop/process";
import { device, endpoint, nonceBody } from "@/lib/desktop/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const actor = await device(request);
    return authorizeTransfer(
      actor,
      (await context.params).id,
      await nonceBody(request),
    );
  });
}
