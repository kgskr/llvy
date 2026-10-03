import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/pending-upload-store", () => ({ createPendingUpload: vi.fn() }));
vi.mock("@/lib/session", () => ({ hasValidSession: vi.fn() }));

import { createPendingUpload } from "@/lib/pending-upload-store";
import { hasValidSession } from "@/lib/session";

import { POST } from "./route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/uploads", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(hasValidSession).mockResolvedValue(true);
  });

  it("creates a binding for a replay filename", async () => {
    const binding = {
      uploadId: "upload-id",
      nonce: "nonce",
      pathname: "replays/upload-id.rofl",
    };
    vi.mocked(createPendingUpload).mockResolvedValue(binding);

    const response = await POST(request({ filename: "match.ROFL" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(binding);
    expect(createPendingUpload).toHaveBeenCalledTimes(1);
  });

  it("rejects unauthenticated uploads without creating a binding", async () => {
    vi.mocked(hasValidSession).mockResolvedValue(false);

    const response = await POST(request({ filename: "match.rofl" }));

    expect(response.status).toBe(401);
    expect(createPendingUpload).not.toHaveBeenCalled();
  });

  it("rejects non-replay files without creating a binding", async () => {
    const response = await POST(request({ filename: "match.txt" }));

    expect(response.status).toBe(400);
    expect(createPendingUpload).not.toHaveBeenCalled();
  });

  it.each([null, [], "invalid", 42])(
    "rejects non-object JSON: %j",
    async (body) => {
      const response = await POST(request(body));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid JSON body." });
      expect(createPendingUpload).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed JSON without creating a binding", async () => {
    const response = await POST(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    expect(createPendingUpload).not.toHaveBeenCalled();
  });
});
