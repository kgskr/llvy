vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => {}) }));
import { ownerSession, ownerUploadFields } from "@/test/actor";
import { UnauthorizedError } from "@/lib/auth-errors";
import { recordAudit } from "@/lib/audit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@vercel/blob", () => ({ del: vi.fn() }));
vi.mock("@/lib/ingest", () => ({ ingestReplay: vi.fn() }));
vi.mock("@/lib/pending-upload-store", () => ({
  claimPendingUpload: vi.fn(),
  finishPendingUpload: vi.fn(),
  getPendingUpload: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { del } from "@vercel/blob";

import { ingestReplay } from "@/lib/ingest";
import { MAX_UPLOAD_BYTES } from "@/lib/limits";
import { hashNonce } from "@/lib/pending-upload";
import {
  claimPendingUpload,
  finishPendingUpload,
  getPendingUpload,
} from "@/lib/pending-upload-store";
import { parseRofl, RoflParseError } from "@/lib/rofl/parser";
import { getSession } from "@/lib/session";
import { replayBytes, replayPlayer } from "@/test/replay";

import { POST } from "./route";

const uploadId = "12345678-1234-1234-1234-123456789abc";
const nonce = "test-upload-secret";
const blobToken = "vercel_blob_rw_test_secret";
const pathname = `replays/${uploadId}.rofl`;
const blobUrl = `https://test.public.blob.vercel-storage.com/${pathname}`;
const result = { gameId: "stored-game", duplicate: false };
const payload = {
  uploadId,
  nonce,
  blobUrl,
  originalFilename: "match.rofl",
  lastModified: Date.UTC(2025, 0, 1),
};

function request(body: unknown = payload): Request {
  return new Request("http://localhost/api/process", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/process", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", blobToken);
    vi.stubEnv("BLOB_ACCESS", "public");
    vi.mocked(getSession).mockResolvedValue(ownerSession);
    vi.mocked(getPendingUpload).mockResolvedValue({
      id: uploadId,
      nonceHash: hashNonce(nonce),
      ...ownerUploadFields,
      pathname,
      state: "pending",
      blobUrl: null,
      cleanupClaimedAt: null,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    vi.mocked(claimPendingUpload).mockResolvedValue(true);
    vi.mocked(finishPendingUpload).mockResolvedValue(undefined);
    vi.mocked(ingestReplay).mockResolvedValue(result);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("replay")));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    "https://other.public.blob.vercel-storage.com",
    "https://test.private.blob.vercel-storage.com",
    "https://test.public.blob.vercel-storage.com:8443",
    "https://user:secret@test.public.blob.vercel-storage.com",
  ])(
    "rejects a foreign authority before claiming or touching its blob: %s",
    async (origin) => {
      const response = await POST(
        request({ ...payload, blobUrl: `${origin}/${pathname}` }),
      );
      expect(response.status).toBe(400);
      expect(claimPendingUpload).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
      expect(ingestReplay).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the trusted store cannot be configured", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "invalid");
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(claimPendingUpload).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("uses the canonical store URL for the claim, download, ingest and duplicate cleanup", async () => {
    vi.stubEnv("BLOB_STORE_ID", "different-store");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "different-authority");
    vi.mocked(ingestReplay).mockResolvedValue({ ...result, duplicate: true });
    const response = await POST(
      request({ ...payload, blobUrl: `${blobUrl}?download=1#replay` }),
    );
    expect(response.status).toBe(200);
    expect(claimPendingUpload).toHaveBeenCalledWith(uploadId, blobUrl);
    expect(fetch).toHaveBeenCalledWith(blobUrl, {
      signal: expect.any(AbortSignal),
      redirect: "error",
      cache: "no-store",
    });
    expect(ingestReplay).toHaveBeenCalledWith(
      expect.objectContaining({ blobUrl }),
    );
    expect(del).toHaveBeenCalledExactlyOnceWith(blobUrl, {
      token: blobToken,
      abortSignal: expect.any(AbortSignal),
    });
  });

  it("authenticates only the canonical private object and cleans its duplicate", async () => {
    vi.stubEnv("BLOB_ACCESS", "private");
    vi.stubEnv("BLOB_STORE_ID", "different-store");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "different-authority");
    vi.mocked(ingestReplay).mockResolvedValue({ ...result, duplicate: true });
    const privateUrl = `https://test.private.blob.vercel-storage.com/${pathname}`;
    const response = await POST(
      request({ ...payload, blobUrl: `${privateUrl}?download=1#replay` }),
    );
    expect(response.status).toBe(200);
    expect(claimPendingUpload).toHaveBeenCalledWith(uploadId, privateUrl);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(privateUrl, {
      signal: expect.any(AbortSignal),
      redirect: "error",
      cache: "no-store",
      headers: { authorization: `Bearer ${blobToken}` },
    });
    expect(ingestReplay).toHaveBeenCalledWith(
      expect.objectContaining({ blobUrl: privateUrl }),
    );
    expect(del).toHaveBeenCalledExactlyOnceWith(privateUrl, {
      token: blobToken,
      abortSignal: expect.any(AbortSignal),
    });
  });

  it.each([
    blobUrl,
    `https://other.private.blob.vercel-storage.com/${pathname}`,
    `https://test.private.blob.vercel-storage.com:8443/${pathname}`,
    `https://user:password@test.private.blob.vercel-storage.com/${pathname}`,
    "https://test.private.blob.vercel-storage.com/replays/another.rofl",
  ])(
    "rejects an unbound private-mode URL before sending credentials: %s",
    async (url) => {
      vi.stubEnv("BLOB_ACCESS", "private");
      const response = await POST(request({ ...payload, blobUrl: url }));
      expect(response.status).toBe(400);
      expect(claimPendingUpload).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
      expect(ingestReplay).not.toHaveBeenCalled();
    },
  );

  it.each(["RIOT_ID_TAG_LINE", "TEAM_POSITION", "WIN"])(
    "cleans a malformed %s rejected by the real parser with a 422 response",
    async (field) => {
      const bytes = replayBytes({
        players: [replayPlayer({ [field]: { toString: null } })],
      });
      vi.mocked(fetch).mockResolvedValue(new Response(Uint8Array.from(bytes)));
      vi.mocked(ingestReplay).mockImplementation(async ({ bytes }) => {
        parseRofl(bytes);
        throw new Error("Invalid replay unexpectedly passed parsing.");
      });
      const response = await POST(request());
      expect(response.status).toBe(422);
      expect(del).toHaveBeenCalledExactlyOnceWith(blobUrl, {
        token: blobToken,
        abortSignal: expect.any(AbortSignal),
      });
      expect(finishPendingUpload).toHaveBeenCalledWith(uploadId, "failed");
      expect(console.error).not.toHaveBeenCalled();
    },
  );

  it("preserves the canonical blob after a new game is committed", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(ingestReplay).toHaveBeenCalledWith({
      actor: ownerSession,
      uploadId,
      bytes: new TextEncoder().encode("replay"),
      blobUrl,
      originalFilename: payload.originalFilename,
      lastModified: payload.lastModified,
    });
    expect(finishPendingUpload).toHaveBeenCalledWith(uploadId, "processed");
    expect(del).not.toHaveBeenCalled();
  });

  it("retries a failed terminal-state update without deleting a committed replay", async () => {
    vi.mocked(finishPendingUpload).mockRejectedValueOnce(
      new Error("DB unavailable"),
    );

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(finishPendingUpload).toHaveBeenCalledTimes(2);
    expect(finishPendingUpload).toHaveBeenLastCalledWith(uploadId, "processed");
    expect(del).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("returns committed success and logs when terminal-state updates keep failing", async () => {
    vi.mocked(finishPendingUpload).mockRejectedValue(
      new Error("DB unavailable"),
    );

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(finishPendingUpload).toHaveBeenCalledTimes(2);
    expect(finishPendingUpload).not.toHaveBeenCalledWith(uploadId, "failed");
    expect(del).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "Failed to finalize upload state:",
      { uploadId, state: "processed" },
      expect.any(Error),
    );
  });

  it("deletes only this upload's orphan blob for a duplicate", async () => {
    vi.mocked(ingestReplay).mockResolvedValue({ ...result, duplicate: true });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...result, duplicate: true });
    expect(del).toHaveBeenCalledExactlyOnceWith(blobUrl, {
      token: blobToken,
      abortSignal: expect.any(AbortSignal),
    });
    expect(finishPendingUpload).toHaveBeenCalledWith(uploadId, "processed");
  });

  it("keeps a parsing failure descriptive even when finalization fails", async () => {
    vi.mocked(ingestReplay).mockRejectedValue(
      new RoflParseError("Invalid replay"),
    );
    vi.mocked(finishPendingUpload).mockRejectedValue(
      new Error("DB unavailable"),
    );

    const response = await POST(request());

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Invalid replay" });
    expect(del).toHaveBeenCalledExactlyOnceWith(blobUrl, {
      token: blobToken,
      abortSignal: expect.any(AbortSignal),
    });
    expect(finishPendingUpload).toHaveBeenCalledTimes(2);
    expect(finishPendingUpload).toHaveBeenLastCalledWith(uploadId, "failed");
  });

  it("preserves the bound blob when a database error leaves the commit outcome unknown", async () => {
    const error = new Error("Connection lost while awaiting COMMIT");
    vi.mocked(ingestReplay).mockRejectedValue(error);

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to process the replay.",
    });
    expect(del).not.toHaveBeenCalled();
    expect(finishPendingUpload).toHaveBeenCalledWith(uploadId, "failed");
    expect(console.error).toHaveBeenCalledWith(
      "Replay ingestion failed; preserving blob because commit outcome may be unknown:",
      { uploadId, blobUrl },
      error,
    );
  });

  it("returns a download failure and consumes the binding", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network unavailable"));

    const response = await POST(request());

    expect(response.status).toBe(502);
    expect(ingestReplay).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledExactlyOnceWith(blobUrl, {
      token: blobToken,
      abortSignal: expect.any(AbortSignal),
    });
    expect(finishPendingUpload).toHaveBeenCalledWith(uploadId, "failed");
  });

  it.each(["headers", "body"] as const)(
    "aborts a stalled download while awaiting %s and finalizes the failed binding",
    async (phase) => {
      const download = new AbortController();
      const timeout = vi
        .spyOn(AbortSignal, "timeout")
        .mockReturnValue(download.signal);
      const rejectOnAbort = () =>
        new Promise<never>((_resolve, reject) => {
          download.signal.addEventListener(
            "abort",
            () => reject(download.signal.reason),
            { once: true },
          );
          queueMicrotask(() =>
            download.abort(
              new DOMException("Download timed out", "TimeoutError"),
            ),
          );
        });
      vi.mocked(fetch).mockImplementation(async (_url, options) => {
        expect(options?.signal).toBe(download.signal);
        if (phase === "headers") return rejectOnAbort();
        const response = new Response("replay");
        vi.spyOn(response, "arrayBuffer").mockImplementation(rejectOnAbort);
        return response;
      });

      const response = await POST(request());

      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        error: "Could not download the uploaded file.",
      });
      expect(timeout).toHaveBeenCalledWith(20_000);
      expect(ingestReplay).not.toHaveBeenCalled();
      expect(del).toHaveBeenCalledExactlyOnceWith(blobUrl, {
        token: blobToken,
        abortSignal: expect.any(AbortSignal),
      });
      expect(finishPendingUpload).toHaveBeenCalledWith(uploadId, "failed");
    },
  );

  it("returns duplicate success even when bounded blob cleanup times out", async () => {
    vi.useFakeTimers();
    vi.mocked(ingestReplay).mockResolvedValue({ ...result, duplicate: true });
    // Model an SDK request stuck in retry backoff: abort alone may not settle
    // its promise immediately, but the response must still have a time bound.
    vi.mocked(del).mockReturnValue(new Promise(() => {}));

    const pendingResponse = POST(request());
    await vi.advanceTimersByTimeAsync(5_000);
    const response = await pendingResponse;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...result, duplicate: true });
    expect(del).toHaveBeenCalledExactlyOnceWith(blobUrl, {
      token: blobToken,
      abortSignal: expect.any(AbortSignal),
    });
    expect(vi.mocked(del).mock.calls[0][1]?.abortSignal?.aborted).toBe(true);
    expect(finishPendingUpload).toHaveBeenCalledWith(uploadId, "processed");
    expect(console.error).toHaveBeenCalledWith(
      "Failed to delete this upload's blob:",
      expect.objectContaining({ name: "AbortError" }),
    );
  });

  it("rejects oversized downloads before ingestion", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("", {
        headers: { "content-length": String(MAX_UPLOAD_BYTES + 1) },
      }),
    );

    const response = await POST(request());

    expect(response.status).toBe(413);
    expect(ingestReplay).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledExactlyOnceWith(blobUrl, {
      token: blobToken,
      abortSignal: expect.any(AbortSignal),
    });
    expect(finishPendingUpload).toHaveBeenCalledWith(uploadId, "failed");
  });

  it("does not fetch or delete a blob after a binding claim is rejected", async () => {
    vi.mocked(claimPendingUpload).mockResolvedValue(false);

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(ingestReplay).not.toHaveBeenCalled();
    expect(finishPendingUpload).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated processing before reading storage", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(getPendingUpload).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects viewer processing before reading any binding or blob", async () => {
    vi.mocked(getSession).mockResolvedValue({
      ...ownerSession,
      role: "viewer",
    });
    expect((await POST(request())).status).toBe(403);
    expect(getPendingUpload).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(ingestReplay).not.toHaveBeenCalled();
  });

  it("rejects another administrator's binding before claim/fetch/delete", async () => {
    vi.mocked(getSession).mockResolvedValue({
      ...ownerSession,
      role: "admin",
      memberId: crypto.randomUUID(),
      credentialId: crypto.randomUUID(),
    });
    expect((await POST(request())).status).toBe(403);
    expect(claimPendingUpload).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("rejects authority revoked during download and records the failure", async () => {
    vi.mocked(ingestReplay).mockRejectedValue(new UnauthorizedError());
    expect((await POST(request())).status).toBe(403);
    expect(del).toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      ownerSession,
      expect.objectContaining({
        result: "failure",
        requestId: uploadId,
        after: { reason: "authority_revoked" },
      }),
    );
  });

  it.each([null, [], "invalid", 42])(
    "rejects non-object JSON: %j",
    async (body) => {
      const response = await POST(request(body));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid JSON body." });
      expect(getPendingUpload).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
