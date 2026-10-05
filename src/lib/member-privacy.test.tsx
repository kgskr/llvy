import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  token: undefined as string | undefined,
  findActiveAdmin: vi.fn(),
  listMembers: vi.fn(),
  gameDetail: vi.fn(),
  history: vi.fn(),
  listGames: vi.fn(),
  countGames: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: mocks.token }) }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  redirect: (destination: string) => {
    throw new Error(`redirect:${destination}`);
  },
  notFound: () => {
    throw new Error("not-found");
  },
}));
vi.mock("@/lib/admin-credentials", () => ({
  findActiveAdmin: mocks.findActiveAdmin,
}));
vi.mock("@/lib/members", () => ({
  listMembersWithAccounts: mocks.listMembers,
}));
vi.mock("@/lib/games", () => ({
  getGameDetail: mocks.gameDetail,
  listGames: mocks.listGames,
  countGames: mocks.countGames,
}));
vi.mock("@/lib/member-history", () => ({ getMemberHistory: mocks.history }));
vi.mock("@/lib/champions", () => ({
  resolveChampionNames: async () => new Map(),
}));
vi.mock("@/app/login/actions", () => ({ logout: vi.fn() }));
vi.mock("@/app/(app)/games/forms", () => ({
  GameFeedbackProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  GameDateForm: () => <div data-management="date" />,
  GameCommentForm: () => <div data-management="comment" />,
  GameVisibilityForm: ({ excluded }: { excluded: boolean }) => (
    <div data-management={excluded ? "restore" : "exclude"} />
  ),
}));
vi.mock("@/app/(app)/upload/upload-form", () => ({
  default: () => <div>업로드 입력</div>,
}));

import AppLayout from "@/app/(app)/layout";
import HomePage from "@/app/(app)/page";
import GamesPage from "@/app/(app)/games/page";
import GameDetailPage from "@/app/(app)/games/[id]/page";
import MembersPage from "@/app/(app)/members/page";
import MemberHistoryPage from "@/app/(app)/members/[id]/page";
import UploadPage from "@/app/(app)/upload/page";
import { createSessionToken, type SessionRole } from "@/lib/auth";
import {
  maskMemberName,
  memberDisplayName,
  projectMember,
} from "@/lib/member-privacy";
import {
  getGameDetailReadModel,
  getGameListReadModel,
  getMemberHistoryReadModel,
  getMembersReadModel,
} from "@/lib/read-model";

const MEMBER_ID = randomUUID();
const CREDENTIAL_ID = randomUUID();
const GAME_ID = randomUUID();
const ACCOUNT = { id: randomUUID(), gameName: "RiotNickname", tagLine: "KR1" };
const MEMBER = {
  id: MEMBER_ID,
  name: "김길수",
  birthYear: 1991,
  accounts: [ACCOUNT],
};
const PARTICIPANT = {
  id: randomUUID(),
  team: 100,
  position: "MIDDLE",
  champion: "Ahri",
  win: true,
  kills: 2,
  deaths: 3,
  assists: 4,
  goldEarned: 12000,
  gameName: ACCOUNT.gameName,
  tagLine: ACCOUNT.tagLine,
  memberId: MEMBER_ID,
  memberName: MEMBER.name,
};
const GAME = {
  id: GAME_ID,
  playedAt: "2026-10-02",
  playedAtSource: "file_mtime",
  originalPlayedAt: "2026-10-02",
  originalPlayedAtSource: "file_mtime",
  playedAtOverride: null,
  comment: null,
  durationMs: 1200000,
  gameVersion: "16.19",
  winningTeam: 100,
  excludedAt: null,
  participants: [PARTICIPANT],
};
const HISTORY = {
  member: MEMBER,
  accounts: [ACCOUNT],
  stats: {
    totalGames: 0,
    wins: 0,
    losses: 0,
    undecided: 0,
    winRate: null,
    averageKills: null,
    averageDeaths: null,
    averageAssists: null,
  },
  championStats: [],
  positionStats: [],
  games: [],
};

async function signIn(role: SessionRole) {
  mocks.token = await createSessionToken(
    role === "admin"
      ? { role, memberId: MEMBER_ID, credentialId: CREDENTIAL_ID }
      : role,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.token = undefined;
  vi.stubEnv("READ_PASSWORD", "test-viewer-key");
  vi.stubEnv("OWNER_PASSWORD", "test-owner-key");
  vi.stubEnv("AUTH_SECRET", "independent-secret-with-at-least-32-bytes");
  mocks.findActiveAdmin.mockResolvedValue({
    role: "admin",
    memberId: MEMBER_ID,
    credentialId: CREDENTIAL_ID,
    name: MEMBER.name,
  });
  mocks.listMembers.mockResolvedValue([MEMBER]);
  mocks.gameDetail.mockResolvedValue(GAME);
  mocks.history.mockResolvedValue(HISTORY);
  mocks.listGames.mockResolvedValue([]);
  mocks.countGames.mockResolvedValue(0);
});
afterEach(() => vi.unstubAllEnvs());

describe("privacy-safe member projection", () => {
  it.each([
    ["김길수", "김*수"],
    ["홍길동철", "홍**철"],
    ["김수", "김*"],
    ["김", "*"],
    ["김길수".normalize("NFD"), "김*수"],
    ["김👨‍👩‍👧‍👦수", "김*수"],
  ])("masks graphemes in %s", (name, masked) => {
    expect(maskMemberName(name)).toBe(masked);
  });

  it("omits the birthYear property and preserves raw records", () => {
    const projected = projectMember(MEMBER, "viewer");
    expect(projected).not.toHaveProperty("birthYear");
    expect(projected.name).toBe("김*수");
    expect(MEMBER.name).toBe("김길수");
    expect(MEMBER.birthYear).toBe(1991);
    for (const role of ["admin", "owner"] as const) {
      expect(projectMember(MEMBER, role)).toEqual(MEMBER);
      expect(memberDisplayName(MEMBER.name, role)).toBe(MEMBER.name);
    }
  });

  it("removes original names and birth years before serializing read models", async () => {
    await signIn("viewer");
    const members = await getMembersReadModel();
    const history = await getMemberHistoryReadModel(MEMBER_ID);
    const game = await getGameDetailReadModel(GAME_ID);
    for (const payload of [members, history, game]) {
      const serialized = JSON.stringify(payload);
      expect(serialized).toContain("김*수");
      expect(serialized).not.toContain(MEMBER.name);
      expect(serialized).not.toContain("birthYear");
      expect(serialized).not.toContain("1991");
      expect(serialized).not.toContain(mocks.token);
      expect(serialized).toContain(ACCOUNT.gameName);
    }
    expect(history.history?.member).not.toHaveProperty("accounts");
    expect(members.members[0]).not.toHaveProperty("birthYear");
    expect(history.history?.member).not.toHaveProperty("birthYear");
  });

  it("projects each request independently across role changes", async () => {
    for (const role of ["owner", "viewer", "admin", "viewer"] as const) {
      await signIn(role);
      const { members } = await getMembersReadModel();
      expect(members[0].name).toBe(role === "viewer" ? "김*수" : MEMBER.name);
      expect("birthYear" in members[0]).toBe(role !== "viewer");
    }
    expect(mocks.listMembers).toHaveBeenCalledTimes(4);
  });
});

describe("read model authorization and page privacy", () => {
  it("blocks unauthenticated reads before querying", async () => {
    for (const read of [
      () => getMembersReadModel(),
      () => getGameDetailReadModel(GAME_ID),
      () => getMemberHistoryReadModel(MEMBER_ID),
      () => getGameListReadModel(25, undefined),
    ]) {
      await expect(read()).rejects.toThrow("redirect:/login");
    }
    for (const query of [
      mocks.listMembers,
      mocks.gameDetail,
      mocks.history,
      mocks.listGames,
      mocks.countGames,
    ]) {
      expect(query).not.toHaveBeenCalled();
    }
  });

  it("rechecks administrator credentials and blocks revoked reads", async () => {
    await signIn("admin");
    expect((await getMembersReadModel()).members[0].name).toBe(MEMBER.name);
    mocks.listMembers.mockClear();
    mocks.findActiveAdmin.mockResolvedValue(null);
    await expect(getMembersReadModel()).rejects.toThrow("redirect:/login");
    await expect(getGameDetailReadModel(GAME_ID)).rejects.toThrow(
      "redirect:/login",
    );
    await expect(getMemberHistoryReadModel(MEMBER_ID)).rejects.toThrow(
      "redirect:/login",
    );
    expect(mocks.listMembers).not.toHaveBeenCalled();
    expect(mocks.gameDetail).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it.each(["viewer", "admin", "owner"] as const)(
    "renders only permitted names, birth years, controls and navigation for %s",
    async (role) => {
      await signIn(role);
      const privileged = role !== "viewer";
      const members = renderToStaticMarkup(await MembersPage());
      const history = renderToStaticMarkup(
        await MemberHistoryPage({
          params: Promise.resolve({ id: MEMBER_ID }),
          searchParams: Promise.resolve({}),
        }),
      );
      const game = renderToStaticMarkup(
        await GameDetailPage({
          params: Promise.resolve({ id: GAME_ID }),
          searchParams: Promise.resolve({}),
        }),
      );
      const games = renderToStaticMarkup(
        await GamesPage({ searchParams: Promise.resolve({}) }),
      );
      const layout = renderToStaticMarkup(
        await AppLayout({ children: <p>ゲーム</p> }),
      );
      for (const html of [members, history, game]) {
        expect(html).toContain(privileged ? MEMBER.name : "김*수");
        expect(html.includes(MEMBER.name)).toBe(privileged);
        expect(html).toContain(ACCOUNT.gameName);
      }
      expect(members.includes("1991")).toBe(privileged);
      expect(members).not.toContain("undefined");
      for (const html of [members, history, layout]) {
        expect(html.includes('href="/admin"')).toBe(privileged);
      }
      for (const html of [history, games, layout]) {
        expect(html.includes('href="/upload"')).toBe(privileged);
      }
      expect(game.includes('data-management="date"')).toBe(privileged);
      expect(game.includes('data-management="comment"')).toBe(privileged);
      expect(game.includes('data-management="exclude"')).toBe(privileged);
      expect(layout).toMatch(
        /<a(?=[^>]*class="nav-brand")(?=[^>]*href="\/")[^>]*>/,
      );
      expect(layout).toContain('href="/members"');
      expect(layout).not.toContain("업로더");
      expect(layout).not.toContain('href="/admin/audit"');
    },
  );

  it("shows member history calendar dates without time while retaining duration", async () => {
    await signIn("viewer");
    mocks.history.mockResolvedValue({
      ...HISTORY,
      stats: { ...HISTORY.stats, totalGames: 1, wins: 1, winRate: 100 },
      games: [
        {
          id: GAME_ID,
          playedAt: "2026-10-02",
          playedAtSource: "file_mtime",
          durationMs: 1200000,
          champion: "Ahri",
          position: "MIDDLE",
          kills: 2,
          deaths: 3,
          assists: 4,
          result: "win",
          ambiguous: false,
        },
      ],
    });
    const html = renderToStaticMarkup(
      await MemberHistoryPage({
        params: Promise.resolve({ id: MEMBER_ID }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(html).toContain("김*수의 전적");
    expect(html).toContain("2026. 10. 2.");
    expect(html).toContain("20분 00초");
    expect(html).not.toContain("오후");
    expect(html).not.toContain("오전");
    expect(html).not.toContain("한국 시간 기준");
  });

  it("protects the upload page without depending on the layout or proxy", async () => {
    await expect(UploadPage()).rejects.toThrow("redirect:/login");
    await signIn("viewer");
    await expect(UploadPage()).rejects.toThrow("redirect:/games");
    for (const role of ["admin", "owner"] as const) {
      await signIn(role);
      expect(renderToStaticMarkup(await UploadPage())).toContain("업로드 입력");
    }
    await signIn("admin");
    mocks.findActiveAdmin.mockResolvedValue(null);
    await expect(UploadPage()).rejects.toThrow("redirect:/login");
  });

  it.each(["viewer", "admin", "owner"] as const)(
    "shows calendar dates and escaped whitespace-preserving shared comments to %s",
    async (role) => {
      await signIn(role);
      const comment = "  <script>x</script>\n 메모  ";
      mocks.gameDetail.mockResolvedValue({ ...GAME, comment });
      mocks.listGames.mockResolvedValue([
        { ...GAME, comment, participantCount: 1 },
      ]);
      mocks.countGames.mockResolvedValue(1);
      const detail = renderToStaticMarkup(
        await GameDetailPage({
          params: Promise.resolve({ id: GAME_ID }),
          searchParams: Promise.resolve({}),
        }),
      );
      const list = renderToStaticMarkup(
        await GamesPage({ searchParams: Promise.resolve({}) }),
      );
      for (const html of [detail, list]) {
        expect(html).toContain("2026. 10. 2.");
        expect(html).toContain("20분 00초");
        expect(html).toContain("  &lt;script&gt;x&lt;/script&gt;\n 메모  ");
        expect(html).toContain("white-space:pre-wrap");
        expect(html).not.toContain("<script>x</script>");
        expect(html).not.toContain("오후");
        expect(html).not.toContain("오전");
      }
      expect(detail.includes('data-management="comment"')).toBe(
        role !== "viewer",
      );
    },
  );

  it.each(["viewer", "admin", "owner"] as const)(
    "shows the search landing for %s without querying member or game records",
    async (role) => {
      await signIn(role);
      const html = renderToStaticMarkup(await HomePage());
      expect(html).toContain('type="search"');
      expect(html).toContain('action="/search"');
      expect(html).toContain('method="get"');
      expect(html).toContain('role="combobox"');
      expect(html).not.toContain("검색 기능은 준비 중입니다.");
      expect(mocks.listMembers).not.toHaveBeenCalled();
      expect(mocks.gameDetail).not.toHaveBeenCalled();
    },
  );

  it("requires a session for the search landing", async () => {
    await expect(HomePage()).rejects.toThrow("redirect:/login");
  });
});
