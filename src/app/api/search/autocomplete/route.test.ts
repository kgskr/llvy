import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  autocomplete: vi.fn(),
  unified: vi.fn(),
  auth: vi.fn(),
}));
vi.mock("@/lib/nickname-search", () => ({
  autocompleteStoredNicknames: mocks.autocomplete,
  autocompleteSearch: mocks.unified,
}));
vi.mock("@/lib/session", () => ({ assertSession: mocks.auth }));
import { UnauthorizedError } from "@/lib/auth-errors";
import { GET } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ role: "viewer" });
});

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
    mocks.unified.mockResolvedValue([]);
    const response = await GET(
      new Request("http://localhost/api/search/autocomplete"),
    );
    expect(mocks.unified).toHaveBeenCalledWith("");
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
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).not.toHaveProperty("suggestions");
    expect(body.error).not.toContain("private database");
  });
});

it("returns typed minimal member/account candidates for q", async () => {
  const member = {
    kind: "member",
    id: "11111111-1111-4111-8111-111111111111",
    name: "김길수",
    accounts: [{ gameName: "한글", tagLine: "KR1" }],
  };
  mocks.unified.mockResolvedValue([
    { ...member, birthYear: 1991, discordUserId: "secret" },
  ]);
  const response = await GET(
    new Request("http://localhost/api/search/autocomplete?q=김"),
  );
  expect(await response.json()).toEqual({ suggestions: [member] });
  expect(mocks.unified).toHaveBeenCalledWith("김");
  expect(mocks.autocomplete).not.toHaveBeenCalled();
});
it.each(["q=a&q=b", "nickname=a&nickname=b", "q=&nickname=a"])(
  "rejects conflicting parameters after authentication: %s",
  async (query) => {
    const response = await GET(
      new Request(`http://localhost/api/search/autocomplete?${query}`),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.auth).toHaveBeenCalledOnce();
    expect(mocks.unified).not.toHaveBeenCalled();
    expect(mocks.autocomplete).not.toHaveBeenCalled();
    mocks.auth.mockRejectedValue(new UnauthorizedError());
    expect(
      (
        await GET(
          new Request(`http://localhost/api/search/autocomplete?${query}`),
        )
      ).status,
    ).toBe(401);
  },
);
it("does not return partial success when a unified source fails", async () => {
  mocks.unified.mockRejectedValue(new Error("private DB failure"));
  const response = await GET(
    new Request("http://localhost/api/search/autocomplete?q=a"),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "Autocomplete is unavailable.",
  });
});
