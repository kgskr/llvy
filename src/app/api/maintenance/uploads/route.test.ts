import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/expired-upload-cleanup", () => ({
  reconcileExpiredUploads: vi.fn(),
}));

import { reconcileExpiredUploads } from "@/lib/expired-upload-cleanup";

import { GET } from "./route";

function request(token?: string): Request {
  return new Request("http://localhost/api/maintenance/uploads", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe("expired upload cron", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("CRON_SECRET", "test-cron-secret-long-enough");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects missing and wrong secrets before touching storage", async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("wrong"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request(""))).status).toBe(401);
    expect(reconcileExpiredUploads).not.toHaveBeenCalled();
  });

  it("runs cleanup only with the configured bearer token", async () => {
    vi.mocked(reconcileExpiredUploads).mockResolvedValue({
      examined: 2,
      removed: 2,
      failed: 0,
    });
    const response = await GET(request("test-cron-secret-long-enough"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      examined: 2,
      removed: 2,
      failed: 0,
    });
    expect(reconcileExpiredUploads).toHaveBeenCalledTimes(1);
  });
});
