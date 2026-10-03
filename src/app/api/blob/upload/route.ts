import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { getBlobStoreConfig } from "@/lib/blob-store";
import { MAX_UPLOAD_BYTES } from "@/lib/limits";
import { isUuid, validatePendingToken } from "@/lib/pending-upload";
import { getPendingUpload } from "@/lib/pending-upload-store";
import { hasValidSession } from "@/lib/session";

// Generates short-lived client upload tokens so the browser can upload large
// .rofl files (10-30MB) directly to Blob, bypassing the 4.5MB function body
// limit. The proxy gates this route; we re-check the session here as
// defense-in-depth. A token is minted only for the exact pathname reserved by
// an active pending-upload binding (issued by /api/uploads), so the browser
// can never place a blob this app did not just authorize.
export const runtime = "nodejs";

type BindingPayload = { uploadId: string; nonce: string };

function parseBindingPayload(
  clientPayload: string | null,
): BindingPayload | null {
  if (!clientPayload) return null;
  try {
    const parsed = JSON.parse(clientPayload) as Record<string, unknown>;
    const uploadId = typeof parsed.uploadId === "string" ? parsed.uploadId : "";
    const nonce = typeof parsed.nonce === "string" ? parsed.nonce : "";
    if (!isUuid(uploadId) || nonce === "") return null;
    return { uploadId, nonce };
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: HandleUploadBody;
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
    body = parsed as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const result = await handleUpload({
      body,
      request,
      token: getBlobStoreConfig().token,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const binding = parseBindingPayload(clientPayload);
        if (!binding) {
          throw new Error("Missing upload binding. Start the upload again.");
        }
        const row = await getPendingUpload(binding.uploadId);
        if (!row) {
          throw new Error("Unknown upload binding.");
        }
        const validation = validatePendingToken(row, {
          nonce: binding.nonce,
          pathname,
        });
        if (!validation.ok) {
          throw new Error(validation.reason);
        }
        return {
          allowedContentTypes: ["application/octet-stream"],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          // The bound pathname already embeds an unguessable uploadId, and
          // /api/process matches it exactly — no random suffix.
          addRandomSuffix: false,
          // Issued tokens remain usable after processing. Prevent them from
          // overwriting a committed game's original replay, and expire them
          // with the binding. Retrying in the UI reserves a fresh pathname.
          allowOverwrite: false,
          validUntil: row.expiresAt.getTime(),
        };
      },
      // The client invokes /api/process after upload; no completion webhook is
      // needed (and a Blob webhook would not carry the user's session cookie).
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed." },
      { status: 400 },
    );
  }
}
