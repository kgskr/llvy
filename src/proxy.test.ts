import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { config } from "./proxy";

describe("Web Analytics proxy routing", () => {
  it.each([
    "/_vercel/insights",
    "/_vercel/insights/",
    "/_vercel/insights/script.js",
    "/_vercel/insights/view",
    "/_vercel/insights/event",
    "/_vercel/insights/view?source=login",
  ])("allows anonymous Analytics requests to %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(
      false,
    );
  });

  it.each([
    "/_vercel/insights-private",
    "/_vercel/insights-private/view",
    "/_vercel/insights.js",
    "/_vercel/other",
    "/members",
    "/games",
    "/admin",
    "/api/members",
    "/api/uploads",
    "/login-foo",
  ])("retains authentication coverage for %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(
      true,
    );
  });
});
