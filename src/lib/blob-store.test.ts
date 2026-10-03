import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getBlobStoreConfig } from "./blob-store";

afterEach(() => vi.unstubAllEnvs());

describe("configured Blob store", () => {
  beforeEach(() => vi.stubEnv("BLOB_ACCESS", undefined));

  it("derives the origin from the same read/write token used for uploads", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "  vercel_blob_rw_AbC123_secret  ");
    vi.stubEnv("BLOB_STORE_ID", "another-store");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "different-authority");
    expect(getBlobStoreConfig()).toEqual({
      token: "vercel_blob_rw_AbC123_secret",
      access: "public",
      origin: "https://abc123.public.blob.vercel-storage.com",
    });
  });

  it("uses the private store origin with explicitly configured access", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_AbC123_secret");
    vi.stubEnv("BLOB_ACCESS", " private ");
    expect(getBlobStoreConfig()).toEqual({
      token: "vercel_blob_rw_AbC123_secret",
      access: "private",
      origin: "https://abc123.private.blob.vercel-storage.com",
    });
  });

  it.each(["", " ", "PRIVATE", "public.evil.example"])(
    "fails closed on an invalid access mode: %j",
    (access) => {
      vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_AbC123_secret");
      vi.stubEnv("BLOB_ACCESS", access);
      expect(getBlobStoreConfig).toThrow(
        "BLOB_ACCESS must be public or private.",
      );
    },
  );

  it.each([
    "",
    " ",
    "invalid",
    "vercel_blob_rw_store",
    "vercel_blob_rw__secret",
    "vercel_blob_rw_store_",
    "vercel_blob_rw_bad.store_secret",
    "vercel_blob_rw_user@store_secret",
    "vercel_blob_rw_store:443_secret",
    "vercel_blob_rw_-store_secret",
    "vercel_blob_rw_store-_secret",
    `vercel_blob_rw_${"a".repeat(64)}_secret`,
  ])("rejects invalid credentials without disclosing them: %j", (token) => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", token);
    expect(getBlobStoreConfig).toThrow(
      "Missing or invalid BLOB_READ_WRITE_TOKEN.",
    );
  });
});
