import { canUpload } from "@/lib/capabilities";
import { NextResponse } from "next/server";

import { getBlobStoreConfig } from "@/lib/blob-store";
import {
  createPendingUpload,
  UploadBudgetExceeded,
} from "@/lib/pending-upload-store";
import { getSession } from "@/lib/session";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth-errors";

// Issues a pending-upload binding: the unguessable { uploadId, nonce } pair the
// client must present to /api/blob/upload (token minting) and /api/process
// (fetch + cleanup authorization). One binding authorizes exactly one blob at
// the returned pathname, exactly once.
export const runtime = "nodejs";

type UploadsBody = { filename?: unknown };

export async function POST(request: Request): Promise<NextResponse> {
  // Independent auth check (defense-in-depth beyond the proxy).
  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession();
  } catch {
    return NextResponse.json(
      { error: "Authentication is unavailable." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canUpload(session.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: UploadsBody;
  try {
    const parsed: unknown = await request.json();
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400 },
      );
    }
    body = parsed as UploadsBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const filename = typeof body.filename === "string" ? body.filename : "";
  if (!filename.toLowerCase().endsWith(".rofl")) {
    return NextResponse.json(
      { error: "Only .rofl replay files are allowed." },
      { status: 400 },
    );
  }

  let access: "public" | "private";
  try {
    ({ access } = getBlobStoreConfig());
  } catch {
    return NextResponse.json(
      { error: "Upload storage is unavailable." },
      { status: 503 },
    );
  }
  let created;
  try {
    created = await createPendingUpload(session.token, session, filename);
  } catch (error) {
    if (error instanceof UploadBudgetExceeded) {
      return NextResponse.json(
        { error: "Upload limit reached. Try again later." },
        { status: 429 },
      );
    }
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return NextResponse.json(
        {
          error:
            error instanceof UnauthorizedError ? "Unauthorized" : "Forbidden",
        },
        { status: error instanceof UnauthorizedError ? 401 : 403 },
      );
    }
    return NextResponse.json(
      { error: "Upload reservation is unavailable." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  // Expose only the store's access mode, never its read/write credential.
  return NextResponse.json({ ...created, access });
}
