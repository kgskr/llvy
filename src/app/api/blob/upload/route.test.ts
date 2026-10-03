import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@vercel/blob/client", () => ({ handleUpload: vi.fn() }));
vi.mock("@/lib/pending-upload-store", () => ({ getPendingUpload: vi.fn() }));
vi.mock("@/lib/session", () => ({ hasValidSession: vi.fn() }));

import { handleUpload, type HandleUploadOptions } from "@vercel/blob/client";

import { MAX_UPLOAD_BYTES } from "@/lib/limits";
import { hashNonce } from "@/lib/pending-upload";
import { getPendingUpload } from "@/lib/pending-upload-store";
import { hasValidSession } from "@/lib/session";

import { POST } from "./route";

const uploadId = "12345678-1234-1234-1234-123456789abc";
const nonce = "test-upload-secret";
const pathname = `replays/${uploadId}.rofl`;
const expiresAt = new Date(Date.now() + 30 * 60_000);
const pending = {
  id: uploadId,
  nonceHash: hashNonce(nonce),
  pathname,
  state: "pending",
  blobUrl: null,
  createdAt: new Date(),
  expiresAt,
};

const payload = {
  type: "blob.generate-client-token",
  payload: { pathname, clientPayload: JSON.stringify({ uploadId, nonce }) },
};

function request(body: unknown = payload): Request {
  return new Request("http://localhost/api/blob/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

type Constraints = Awaited<
  ReturnType<HandleUploadOptions["onBeforeGenerateToken"]>
>;

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/blob/upload", () => {
  let issuedConstraints: Constraints | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test_secret");
    issuedConstraints = undefined;
    vi.mocked(hasValidSession).mockResolvedValue(true);
    vi.mocked(getPendingUpload).mockResolvedValue(pending);
    vi.mocked(handleUpload).mockImplementation(async (options) => {
      if (options.body.type !== "blob.generate-client-token") {
        throw new Error("Invalid event type");
      }
      const { pathname, clientPayload } = options.body.payload;
      issuedConstraints = await options.onBeforeGenerateToken(
        pathname,
        clientPayload,
        false,
      );
      return { type: "blob.generate-client-token", clientToken: "test-token" };
    });
  });

  it("issues a bounded token that cannot overwrite a stored replay", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(vi.mocked(handleUpload).mock.calls[0][0].token).toBe(
      "vercel_blob_rw_test_secret",
    );
    expect(issuedConstraints).toMatchObject({
      allowedContentTypes: ["application/octet-stream"],
      maximumSizeInBytes: MAX_UPLOAD_BYTES,
      addRandomSuffix: false,
      allowOverwrite: false,
      validUntil: expiresAt.getTime(),
    });
    expect(
      vi.mocked(handleUpload).mock.calls[0][0].onUploadCompleted,
    ).toBeUndefined();
  });

  it("rejects an unauthenticated fresh-token request", async () => {
    vi.mocked(hasValidSession).mockResolvedValue(false);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(handleUpload).not.toHaveBeenCalled();
    expect(getPendingUpload).not.toHaveBeenCalled();
  });

  it.each([
    ["consumed", { ...pending, state: "processed" }],
    ["expired", { ...pending, expiresAt: new Date(0) }],
    ["unknown", null],
  ])("rejects a %s binding before issuing a token", async (_label, row) => {
    vi.mocked(getPendingUpload).mockResolvedValue(row);

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(issuedConstraints).toBeUndefined();
  });

  it("rejects a nonce that does not belong to the binding", async () => {
    const response = await POST(
      request({
        ...payload,
        payload: {
          ...payload.payload,
          clientPayload: JSON.stringify({ uploadId, nonce: "wrong" }),
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(issuedConstraints).toBeUndefined();
  });

  it("rejects another replay's pathname", async () => {
    const response = await POST(
      request({
        ...payload,
        payload: { ...payload.payload, pathname: "replays/another-game.rofl" },
      }),
    );

    expect(response.status).toBe(400);
    expect(issuedConstraints).toBeUndefined();
  });

  it.each([null, [], "invalid", 42])(
    "rejects non-object JSON: %j",
    async (body) => {
      const response = await POST(request(body));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid JSON body." });
      expect(handleUpload).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed JSON before calling the Blob SDK", async () => {
    const response = await POST(
      new Request("http://localhost/api/blob/upload", {
        method: "POST",
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    expect(handleUpload).not.toHaveBeenCalled();
  });
});
