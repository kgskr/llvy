import { describe, expect, it } from "vitest";

import {
  generateNonce,
  hashNonce,
  isAllowedBlobHost,
  isUuid,
  replayPathname,
  validatePendingClaim as validateClaimForStore,
  validatePendingToken,
  type PendingUploadRow,
} from "./pending-upload";

const UPLOAD_ID = "b7f9c9a2-1f6c-4c1a-9a44-3f2f0a6f2f11";
const STORE = "https://abc123xyz.public.blob.vercel-storage.com";

function row(overrides: Partial<PendingUploadRow> = {}): PendingUploadRow {
  return {
    id: UPLOAD_ID,
    nonceHash: hashNonce("the-nonce"),
    pathname: replayPathname(UPLOAD_ID),
    state: "pending",
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

function validatePendingClaim(
  row: Parameters<typeof validateClaimForStore>[0],
  claim: Parameters<typeof validateClaimForStore>[1],
) {
  return validateClaimForStore(row, claim, STORE);
}

function boundUrl(): string {
  return `${STORE}/${replayPathname(UPLOAD_ID)}`;
}

describe("validatePendingClaim - /api/process binding", () => {
  it.each([
    "https://other.public.blob.vercel-storage.com",
    "https://abc123xyz.private.blob.vercel-storage.com",
    "https://child.abc123xyz.public.blob.vercel-storage.com",
    "https://abc123xyz.public.blob.vercel-storage.com.evil.example",
    "https://abc123xyz.public.blob.vercel-storage.com:8443",
    "https://user:password@abc123xyz.public.blob.vercel-storage.com",
    "http://abc123xyz.public.blob.vercel-storage.com",
  ])("rejects the reserved pathname at a different authority: %s", (origin) => {
    expect(
      validatePendingClaim(row(), {
        nonce: "the-nonce",
        blobUrl: `${origin}/${replayPathname(UPLOAD_ID)}`,
      }),
    ).toEqual({ ok: false, reason: "url_mismatch" });
  });

  it("accepts equivalent HTTPS origin spelling and the SDK download URL", () => {
    expect(
      validatePendingClaim(row(), {
        nonce: "the-nonce",
        blobUrl: `https://ABC123XYZ.public.blob.vercel-storage.com:443/${replayPathname(UPLOAD_ID)}?download=1#replay`,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects encoded pathname aliases", () => {
    expect(
      validatePendingClaim(row(), {
        nonce: "the-nonce",
        blobUrl: boundUrl().replace("replays/", "replays%2F"),
      }),
    ).toEqual({ ok: false, reason: "url_mismatch" });
  });

  it("accepts the bound URL with the correct nonce while pending", () => {
    expect(
      validatePendingClaim(row(), { nonce: "the-nonce", blobUrl: boundUrl() }),
    ).toEqual({ ok: true });
  });

  it("rejects a known same-store Blob URL that has no binding (Codex finding #2)", () => {
    // The attack: pass an existing game's canonical blob URL to /api/process so
    // duplicate-cleanup deletes it. With bindings, no row exists for it.
    expect(
      validatePendingClaim(null, {
        nonce: "anything",
        blobUrl: `${STORE}/replays/some-existing-game.rofl`,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects a valid binding paired with a DIFFERENT same-store URL", () => {
    // Attacker owns a fresh binding but points it at someone else's blob:
    // must be rejected before any fetch/delete of that URL.
    expect(
      validatePendingClaim(row(), {
        nonce: "the-nonce",
        blobUrl: `${STORE}/replays/other-canonical-object.rofl`,
      }),
    ).toEqual({ ok: false, reason: "url_mismatch" });
  });

  it("rejects the bound pathname on a non-Blob host", () => {
    expect(
      validatePendingClaim(row(), {
        nonce: "the-nonce",
        blobUrl: `https://evil.example.com/${replayPathname(UPLOAD_ID)}`,
      }),
    ).toEqual({ ok: false, reason: "url_mismatch" });
  });

  it("rejects a consumed binding (processed, failed, or mid-processing)", () => {
    for (const state of ["processing", "processed", "failed"]) {
      expect(
        validatePendingClaim(row({ state }), {
          nonce: "the-nonce",
          blobUrl: boundUrl(),
        }),
      ).toEqual({ ok: false, reason: "consumed" });
    }
  });

  it("rejects an expired binding", () => {
    const expired = row({ expiresAt: new Date(Date.now() - 1) });
    expect(
      validatePendingClaim(expired, {
        nonce: "the-nonce",
        blobUrl: boundUrl(),
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a wrong nonce", () => {
    expect(
      validatePendingClaim(row(), {
        nonce: "guessed-nonce",
        blobUrl: boundUrl(),
      }),
    ).toEqual({ ok: false, reason: "nonce_mismatch" });
  });

  it("ignores query strings when matching the bound URL", () => {
    expect(
      validatePendingClaim(row(), {
        nonce: "the-nonce",
        blobUrl: `${boundUrl()}?download=1`,
      }),
    ).toEqual({ ok: true });
  });
});

describe("validatePendingToken - /api/blob/upload binding", () => {
  it("accepts the reserved pathname while pending", () => {
    expect(
      validatePendingToken(row(), {
        nonce: "the-nonce",
        pathname: replayPathname(UPLOAD_ID),
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a different pathname, wrong nonce, consumed and expired bindings", () => {
    const good = { nonce: "the-nonce", pathname: replayPathname(UPLOAD_ID) };
    expect(
      validatePendingToken(row(), { ...good, pathname: "replays/else.rofl" })
        .ok,
    ).toBe(false);
    expect(validatePendingToken(row(), { ...good, nonce: "wrong" }).ok).toBe(
      false,
    );
    expect(validatePendingToken(row({ state: "processed" }), good).ok).toBe(
      false,
    );
    expect(
      validatePendingToken(row({ expiresAt: new Date(Date.now() - 1) }), good)
        .ok,
    ).toBe(false);
    expect(validatePendingToken(null, good).ok).toBe(false);
  });
});

describe("binding primitives", () => {
  it("generates unique url-safe nonces that round-trip through the hash", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashNonce(a)).toBe(hashNonce(a));
    expect(hashNonce(a)).not.toBe(hashNonce(b));
  });

  it("validates uuids", () => {
    expect(isUuid(UPLOAD_ID)).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
  });

  it("only allows https Vercel Blob hosts", () => {
    expect(isAllowedBlobHost(`${STORE}/replays/x.rofl`, STORE)).toBe(true);
    expect(isAllowedBlobHost("https://evil.example.com/x.rofl", STORE)).toBe(
      false,
    );
    expect(
      isAllowedBlobHost(
        "http://abc.public.blob.vercel-storage.com/x.rofl",
        STORE,
      ),
    ).toBe(false);
    expect(isAllowedBlobHost("not a url", STORE)).toBe(false);
  });
});
