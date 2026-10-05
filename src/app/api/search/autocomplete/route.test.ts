import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ autocomplete: vi.fn() }));
vi.mock("@/lib/nickname-search", () => ({
  autocompleteStoredNicknames: mocks.autocomplete,
}));
import { UnauthorizedError } from "@/lib/auth-errors";
import { GET } from "./route";

beforeEach(() => vi.resetAllMocks());

describe("authenticated nickname autocomplete API", () => {
  it("forwards Unicode prefixes and returns only ten nickname DTOs without private member data", async () => {
    mocks.autocomplete.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        id: String(i),
        gameName: "한글닉네임",
        tagLine: String(i),
        memberName: "김길수",
        birthYear: 1991,
      })),
    );
    const response = await GET(
      new Request(
        "http://localhost/api/search/autocomplete?nickname=%ED%95%9C%EA%B8%80%23KR",
      ),
    );
    expect(mocks.autocomplete).toHaveBeenCalledWith("한글#KR");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.suggestions).toHaveLength(10);
    expect(body.suggestions[0]).toEqual({
      id: "0",
      gameName: "한글닉네임",
      tagLine: "0",
    });
    expect(JSON.stringify(body)).not.toContain("김길수");
    expect(JSON.stringify(body)).not.toContain("birthYear");
  });

  it("still invokes the authenticated DAL for empty input", async () => {
    mocks.autocomplete.mockResolvedValue([]);
    const response = await GET(
      new Request("http://localhost/api/search/autocomplete"),
    );
    expect(mocks.autocomplete).toHaveBeenCalledWith("");
    expect(await response.json()).toEqual({ suggestions: [] });
  });

  it("returns a private no-store 401 for expired or revoked sessions", async () => {
    mocks.autocomplete.mockRejectedValue(new UnauthorizedError());
    const response = await GET(
      new Request("http://localhost/api/search/autocomplete?nickname=test"),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("reports service failure without exposing database details or an empty result", async () => {
    mocks.autocomplete.mockRejectedValue(
      new Error("private database credentials"),
    );
    const response = await GET(
      new Request("http://localhost/api/search/autocomplete?nickname=test"),
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).not.toHaveProperty("suggestions");
    expect(body.error).not.toContain("private database");
  });
});
