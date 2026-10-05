import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), assertSession: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/nickname-search", () => ({
  resolveNicknameMember: mocks.resolve,
}));
vi.mock("@/lib/session", () => ({ assertSession: mocks.assertSession }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  redirect: (destination: string) => {
    throw new Error(`redirect:${destination}`);
  },
}));
import { UnauthorizedError } from "@/lib/auth-errors";
import SearchPage from "./page";
import MissingNicknamePage from "./not-found/page";
import { NicknameSearchForm } from "../nickname-search-form";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.assertSession.mockResolvedValue({ role: "viewer" });
});
const MEMBER_ID = "11111111-1111-4111-8111-111111111111";

describe("exact nickname search routes", () => {
  it("navigates a unique member match to the member history", async () => {
    mocks.resolve.mockResolvedValue({ kind: "member", memberId: MEMBER_ID });
    await expect(
      SearchPage({
        searchParams: Promise.resolve({ nickname: "한글닉네임#KR1" }),
      }),
    ).rejects.toThrow(`redirect:/members/${MEMBER_ID}`);
    expect(mocks.resolve).toHaveBeenCalledWith("한글닉네임#KR1");
  });

  it.each(["nobody#KR1", "", ["duplicate", "params"]])(
    "navigates missing or malformed queries to the missing-user page",
    async (nickname) => {
      mocks.resolve.mockResolvedValue({ kind: "missing" });
      await expect(
        SearchPage({ searchParams: Promise.resolve({ nickname }) }),
      ).rejects.toThrow("redirect:/search/not-found");
    },
  );

  it("shows projected member names and safely escaped nicknames for ambiguous matches", async () => {
    mocks.resolve.mockResolvedValue({
      kind: "ambiguous",
      accounts: [
        {
          id: "one",
          gameName: "<script>x</script>",
          tagLine: "KR1",
          memberId: MEMBER_ID,
          memberName: "김*수",
        },
        {
          id: "two",
          gameName: "<script>x</script>",
          tagLine: "KR2",
          memberId: MEMBER_ID,
          memberName: "이*희",
        },
      ],
    });
    const html = renderToStaticMarkup(
      await SearchPage({
        searchParams: Promise.resolve({ nickname: "<script>x</script>" }),
      }),
    );
    expect(html).toContain("김*수의 전적 보기");
    expect(html).toContain("이*희의 전적 보기");
    expect(html).toContain(`href="/members/${MEMBER_ID}"`);
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;#KR1");
    expect(html).not.toContain("<script>x</script>");
    expect(html).not.toContain("birthYear");
    expect(html).not.toContain("김길수");
  });

  it("does not disguise database outages as a missing-user result", async () => {
    mocks.resolve.mockRejectedValue(new Error("database unavailable"));
    await expect(
      SearchPage({ searchParams: Promise.resolve({ nickname: "stored" }) }),
    ).rejects.toThrow("database unavailable");
  });

  it("redirects expired search sessions to login", async () => {
    mocks.resolve.mockRejectedValue(new UnauthorizedError());
    await expect(
      SearchPage({ searchParams: Promise.resolve({ nickname: "stored" }) }),
    ).rejects.toThrow("redirect:/login");
  });

  it("authenticates the missing-user page and presents a real retry form", async () => {
    const html = renderToStaticMarkup(await MissingNicknamePage());
    expect(html).toContain("없는 사용자입니다");
    expect(html).toContain('action="/search"');
    expect(html).toContain('method="get"');
    mocks.assertSession.mockRejectedValue(new UnauthorizedError());
    await expect(MissingNicknamePage()).rejects.toThrow("redirect:/login");
  });

  it("renders a GET combobox with an enabled submit for nonempty text and preserves Unicode input", () => {
    const html = renderToStaticMarkup(
      <NicknameSearchForm initialNickname="한글닉네임#KR1" />,
    );
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('name="nickname"');
    expect(html).toContain('value="한글닉네임#KR1"');
    expect(html).toContain('<button type="submit">검색</button>');
    expect(html).not.toContain("검색 기능은 준비 중입니다.");
  });

  it("keeps the initial GET form usable without JavaScript while requiring nickname input", () => {
    const html = renderToStaticMarkup(<NicknameSearchForm />);
    expect(html).toContain('action="/search"');
    expect(html).toContain('method="get"');
    expect(html).toMatch(
      /<input(?=[^>]*name="nickname")(?=[^>]*required="")[^>]*>/,
    );
    expect(html).toContain('<button type="submit">검색</button>');
    expect(html).not.toContain("disabled");
  });
});
