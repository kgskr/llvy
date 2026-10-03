import { describe, expect, it } from "vitest";
import { sanitizeRedirect } from "./redirect";

describe("login redirect", () => {
  it("preserves internal paths with a query or fragment", () => {
    expect(sanitizeRedirect("/games?page=3#results")).toBe(
      "/games?page=3#results",
    );
    expect(sanitizeRedirect("/games/../upload")).toBe("/upload");
  });

  it.each([
    "https://example.com",
    "//example.com",
    "/\\example.com",
    "/.//example.com",
    "/games/..//example.com",
    "/%2e//example.com",
    "/\n/example.com",
    "/\t/example.com",
    "javascript:alert(1)",
    "",
    "games",
  ])("rejects external or malformed redirect %j", (target) => {
    expect(sanitizeRedirect(target)).toBe("/");
  });

  it("cannot escape the application origin after browser URL normalization", () => {
    const target = "/\\example.com";
    expect(new URL(target, "https://llvy.example").origin).toBe(
      "https://example.com",
    );
    expect(
      new URL(sanitizeRedirect(target), "https://llvy.example").origin,
    ).toBe("https://llvy.example");
  });
});
