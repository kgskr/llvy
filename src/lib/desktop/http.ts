import "server-only";
import { randomUUID } from "node:crypto";
import { UnauthorizedError, ForbiddenError } from "@/lib/auth-errors";
import { BudgetExceeded } from "@/lib/request-budget";
import { trustedClientIp } from "@/lib/trusted-client-ip";
import { credentialActor } from "./authority";
import { DesktopError, exactKeys, object, requireDesktop } from "./protocol";

export async function endpoint(run: () => Promise<unknown>, status = 200) {
  const requestId = randomUUID();
  const headers: Record<string, string> = {
    "cache-control": "private, no-store",
    "x-request-id": requestId,
  };
  try {
    const result = await run();
    const state = (result as { state?: string })?.state;
    return Response.json(result ?? { ok: true }, {
      status: state === "processing" ? 202 : status,
      headers,
    });
  } catch (error) {
    const failure =
      error instanceof DesktopError
        ? error
        : error instanceof UnauthorizedError
          ? new DesktopError("invalid_token", 401)
          : error instanceof ForbiddenError
            ? new DesktopError("forbidden", 403)
            : error instanceof BudgetExceeded
              ? new DesktopError(
                  "quota_exhausted",
                  429,
                  error.resetAt && Number.isFinite(error.resetAt.getTime())
                    ? Math.max(
                        1,
                        Math.ceil(
                          (error.resetAt.getTime() - Date.now()) / 1000,
                        ),
                      )
                    : undefined,
                )
              : new DesktopError("temporarily_unavailable", 503);
    if (failure.retryAfter) headers["retry-after"] = String(failure.retryAfter);
    return Response.json(
      {
        error: {
          code: failure.code,
          message: failure.code,
          retryable: failure.status === 429 || failure.status >= 500,
        },
        requestId,
      },
      { status: failure.status, headers },
    );
  }
}
export function bearer(request: Request) {
  const match = /^Bearer ([A-Za-z0-9._-]{1,200})$/.exec(
    request.headers.get("authorization") ?? "",
  );
  if (!match) throw new DesktopError("invalid_token", 401);
  return match[1];
}
export async function device(request: Request) {
  requireDesktop();
  return credentialActor(bearer(request), "access");
}
export function clientIp(request: Request) {
  const ip = trustedClientIp(request.headers, {
    vercel: process.env.VERCEL,
    nodeEnv: process.env.NODE_ENV,
  });
  if (!ip) throw new DesktopError("untrusted_client", 503);
  return ip;
}
export async function body(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new DesktopError("invalid_content_type", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new DesktopError("invalid_request");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8192) throw new DesktopError("request_too_large", 413);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new DesktopError("invalid_request");
  }
}
export async function nonceBody(request: Request) {
  const value = object(await body(request));
  exactKeys(value, ["nonce"]);
  if (
    typeof value.nonce !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.nonce)
  )
    throw new DesktopError("invalid_binding");
  return value.nonce;
}
