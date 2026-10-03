import { NextResponse } from "next/server";

import { createPendingUpload } from "@/lib/pending-upload-store";
import { hasValidSession } from "@/lib/session";

// Issues a pending-upload binding: the unguessable { uploadId, nonce } pair the
// client must present to /api/blob/upload (token minting) and /api/process
// (fetch + cleanup authorization). One binding authorizes exactly one blob at
// the returned pathname, exactly once.
export const runtime = "nodejs";

type UploadsBody = { filename?: unknown };

export async function POST(request: Request): Promise<NextResponse> {
  // Independent auth check (defense-in-depth beyond the proxy).
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const created = await createPendingUpload();
  return NextResponse.json(created);
}
