import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  token: undefined as string | undefined,
  setCookie: vi.fn(),
  revalidatePath: vi.fn(),
  throttle: vi.fn(),
  createMember: vi.fn(),
  updateMember: vi.fn(),
  linkAccount: vi.fn(),
  unlinkAccount: vi.fn(),
  deleteMember: vi.fn(),
  listMembers: vi.fn(),
  listUnlinked: vi.fn(),
  countMembers: vi.fn(),
  countUnlinkedAccounts: vi.fn(),
  listMemberOptions: vi.fn(),
  getMemberHistory: vi.fn(),
  setGameExcluded: vi.fn(),
  setGamePlayedAt: vi.fn(),
  getGameDetail: vi.fn(),
  countGames: vi.fn(),
  listGames: vi.fn(),
  createPendingUpload: vi.fn(),
  recordAudit: vi.fn(),
  listAuditLogs: vi.fn(),
  adminActive: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "llvy_session" && mocks.token
        ? { value: mocks.token }
        : undefined,
    set: mocks.setCookie,
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (destination: string) => {
    throw new Error(`redirect:${destination}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/lib/login-throttle", () => ({ checkLoginThrottle: mocks.throttle }));
vi.mock("@/lib/member-mutations", () => ({
  createMember: mocks.createMember,
  updateMember: mocks.updateMember,
  linkAccount: mocks.linkAccount,
  unlinkAccount: mocks.unlinkAccount,
  deleteMember: mocks.deleteMember,
  ActiveAdministratorError: class ActiveAdministratorError extends Error {},
}));
vi.mock("@/lib/members", () => ({
  listMembersWithAccounts: mocks.listMembers,
  listUnlinkedAccounts: mocks.listUnlinked,
  countMembers: mocks.countMembers,
  countUnlinkedAccounts: mocks.countUnlinkedAccounts,
  listMemberOptions: mocks.listMemberOptions,
}));
vi.mock("@/lib/game-mutations", () => ({
  setGameExcluded: mocks.setGameExcluded,
  setGamePlayedAt: mocks.setGamePlayedAt,
}));
vi.mock("@/lib/games", () => ({
  getGameDetail: mocks.getGameDetail,
  countGames: mocks.countGames,
  listGames: mocks.listGames,
}));
vi.mock("@/lib/member-history", () => ({
  getMemberHistory: mocks.getMemberHistory,
}));
vi.mock("@/lib/pending-upload-store", () => ({
  createPendingUpload: mocks.createPendingUpload,
  UploadBudgetExceeded: class extends Error {},
}));
vi.mock("@/lib/admin-credentials", async () => {
  const { authenticatePassword } = await import("./auth");
  return {
    findActiveAdmin: async (credentialId: string, memberId: string) =>
      mocks.adminActive &&
      credentialId === ADMIN_ACTOR.credentialId &&
      memberId === ADMIN_ACTOR.memberId
        ? ADMIN_ACTOR
        : null,
    authenticateAccessKey: async (key: string) => {
      const role = authenticatePassword(key);
      if (role)
        return {
          role,
          memberId: null,
          credentialId: null,
          name: role === "owner" ? "서비스 오너" : "일반 사용자",
        };
      return key === ADMIN_KEY && mocks.adminActive ? ADMIN_ACTOR : null;
    },
    listAdminAssignments: async () => [],
  };
});
vi.mock("@/lib/audit", () => ({
  recordAudit: mocks.recordAudit,
  listAuditLogs: mocks.listAuditLogs,
}));
vi.mock("@/app/(app)/admin/credential-controls", () => ({
  CredentialControls: () => (
    <button data-management="credential">관리자 지정</button>
  ),
}));
vi.mock("@/lib/champions", () => ({
  resolveChampionNames: async () => new Map(),
}));
vi.mock("@/app/(app)/games/forms", () => ({
  GameFeedbackProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  GameDateForm: () => <form data-management="date" />,
  GameCommentForm: () => <form data-management="comment" />,
  GameVisibilityForm: ({ excluded }: { excluded: boolean }) => (
    <form data-management={excluded ? "restore" : "exclude"} />
  ),
}));
vi.mock("@/app/(app)/admin/forms", () => ({
  AdminFeedbackProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  MemberForm: () => <form data-management="member" />,
  DeleteMemberForm: () => <form data-management="delete-member" />,
  LinkAccountForm: () => <form data-management="link-account" />,
  UnlinkAccountForm: () => <form data-management="unlink-account" />,
}));

import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  readSessionToken,
} from "./auth";
import {
  assertAdmin,
  ForbiddenError,
  getValidSessionToken,
  hasValidSession,
  UnauthorizedError,
} from "./session";
import { proxy } from "@/proxy";
import { login } from "@/app/login/actions";
import { POST as reserveUpload } from "@/app/api/uploads/route";
import {
  createMemberAction,
  updateMemberAction,
  linkAccountAction,
  unlinkAccountAction,
  deleteMemberAction,
} from "@/app/(app)/admin/actions";
import {
  setGameExcludedAction,
  updateGameDateAction,
  restoreGameDateAction,
} from "@/app/(app)/games/actions";
import AdminPage from "@/app/(app)/admin/page";
import AppLayout from "@/app/(app)/layout";
import GamesPage from "@/app/(app)/games/page";
import GameDetailPage from "@/app/(app)/games/[id]/page";
import MembersPage from "@/app/(app)/members/page";
import MemberHistoryPage from "@/app/(app)/members/[id]/page";

const VIEWER_KEY = "test-viewer-key";
const ADMIN_KEY = "test-administrator-key";
const OWNER_KEY = "test-private-owner-key";
const ADMIN_ACTOR = {
  role: "admin" as const,
  memberId: "11111111-1111-4111-8111-111111111111",
  credentialId: "22222222-2222-4222-8222-222222222222",
  name: "김관리",
};
function sessionToken(role: "viewer" | "admin" | "owner") {
  return createSessionToken(role === "admin" ? ADMIN_ACTOR : role);
}
const GAME_ID = randomUUID();
const MUTATIONS = [
  createMemberAction,
  updateMemberAction,
  linkAccountAction,
  unlinkAccountAction,
  deleteMemberAction,
  setGameExcludedAction,
  updateGameDateAction,
  restoreGameDateAction,
];
const WRITES = [
  mocks.createMember,
  mocks.updateMember,
  mocks.linkAccount,
  mocks.unlinkAccount,
  mocks.deleteMember,
  mocks.setGameExcluded,
  mocks.setGamePlayedAt,
  mocks.revalidatePath,
];

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
}

function mutationForm() {
  return form({
    name: "권한 검증",
    birthYear: "1995",
    memberId: randomUUID(),
    accountId: randomUUID(),
    gameId: GAME_ID,
    excluded: "true",
    playedAt: "2026-10-02T21:00",
    comment: "  권한 테스트  ",
    role: "admin",
    confirmed: "yes",
  });
}

const GAME = {
  id: GAME_ID,
  playedAt: new Date("2026-10-02T12:00:00Z"),
  playedAtSource: "file_mtime",
  originalPlayedAt: new Date("2026-10-02T12:00:00Z"),
  originalPlayedAtSource: "file_mtime",
  playedAtOverride: null,
  comment: "공유 코멘트",
  durationMs: 1200000,
  gameVersion: "16.19",
  winningTeam: 100,
  excludedAt: null,
  participants: [],
  participantCount: 10,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.token = undefined;
  mocks.adminActive = true;
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("VERCEL", undefined);
  vi.stubEnv("READ_PASSWORD", VIEWER_KEY);
  vi.stubEnv("OWNER_PASSWORD", OWNER_KEY);
  vi.stubEnv("AUTH_SECRET", "independent-server-secret-at-least-32-bytes");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test_secret");
  vi.stubEnv("BLOB_ACCESS", "private");
  mocks.throttle.mockResolvedValue(true);
  mocks.recordAudit.mockResolvedValue(undefined);
  mocks.listAuditLogs.mockResolvedValue([]);
  mocks.createMember.mockResolvedValue(randomUUID());
  for (const write of WRITES.slice(1, -1)) write.mockResolvedValue(true);
  mocks.listMembers.mockResolvedValue([]);
  mocks.listUnlinked.mockResolvedValue([]);
  mocks.countMembers.mockResolvedValue(0);
  mocks.countUnlinkedAccounts.mockResolvedValue(0);
  mocks.listMemberOptions.mockResolvedValue([]);
  mocks.getGameDetail.mockResolvedValue(GAME);
  mocks.countGames.mockResolvedValue(1);
  mocks.listGames.mockResolvedValue([GAME]);
  mocks.createPendingUpload.mockResolvedValue({
    uploadId: randomUUID(),
    nonce: "test-nonce",
    pathname: "replays/test.rofl",
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("actual session authorization at mutation entry points", () => {
  it("blocks viewer direct calls to every management action before any write", async () => {
    mocks.token = await sessionToken("viewer");
    await expect(assertAdmin()).rejects.toBeInstanceOf(ForbiddenError);
    for (const action of MUTATIONS) {
      expect(await action(null, mutationForm())).toEqual({
        status: "error",
        message: "관리자 권한이 필요합니다.",
      });
    }
    for (const write of WRITES) expect(write).not.toHaveBeenCalled();
  });

  it("rejects viewer upload reservations independently of Proxy", async () => {
    mocks.token = await sessionToken("viewer");
    const response = await reserveUpload(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        body: JSON.stringify({ filename: "match.rofl", role: "owner" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.createPendingUpload).not.toHaveBeenCalled();
  });

  it("denies revoked administrators before any privileged read or mutation", async () => {
    mocks.token = await sessionToken("admin");
    mocks.adminActive = false;
    expect(await hasValidSession()).toBe(false);
    expect(await getValidSessionToken()).toBeNull();
    await expect(assertAdmin()).rejects.toBeInstanceOf(UnauthorizedError);
    for (const action of MUTATIONS) {
      expect((await action(null, mutationForm()))?.status).toBe("error");
    }
    await expect(AdminPage()).rejects.toThrow(
      "redirect:/login?redirectTo=%2Fadmin",
    );
    expect(mocks.listMembers).not.toHaveBeenCalled();
    expect(mocks.listUnlinked).not.toHaveBeenCalled();
    for (const write of WRITES) expect(write).not.toHaveBeenCalled();
    const response = await reserveUpload(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        body: JSON.stringify({ filename: "match.rofl" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(mocks.createPendingUpload).not.toHaveBeenCalled();
  });

  it.each(["missing", "tampered", "legacy", "expired"])(
    "blocks all management writes for %s sessions",
    async (kind) => {
      const token = await sessionToken("viewer");
      mocks.token =
        kind === "missing"
          ? undefined
          : kind === "tampered"
            ? token.replace(".viewer.", ".admin.")
            : kind === "legacy"
              ? token.replace("v4.viewer", "v3.viewer")
              : token;
      const clock =
        kind === "expired"
          ? vi
              .spyOn(Date, "now")
              .mockReturnValue(
                Date.now() + (SESSION_MAX_AGE_SECONDS + 1) * 1000,
              )
          : null;
      try {
        await expect(assertAdmin()).rejects.toBeInstanceOf(UnauthorizedError);
        for (const action of MUTATIONS) {
          const result = await action(null, mutationForm());
          expect(result?.status).toBe("error");
          expect(result?.message).toContain("로그인");
        }
        for (const write of WRITES) expect(write).not.toHaveBeenCalled();
      } finally {
        clock?.mockRestore();
      }
    },
  );

  it("allows every valid administrator mutation", async () => {
    mocks.token = await sessionToken("admin");
    for (const action of MUTATIONS) {
      expect((await action(null, mutationForm()))?.status).toBe("success");
    }
    for (const write of WRITES) expect(write).toHaveBeenCalled();
  });

  it.each(["admin", "owner"] as const)(
    "preserves %s upload access and its original budget identity",
    async (role) => {
      mocks.token = await sessionToken(role);
      expect(await hasValidSession()).toBe(true);
      expect(await getValidSessionToken()).toBe(mocks.token);
      const response = await reserveUpload(
        new Request("http://localhost/api/uploads", {
          method: "POST",
          body: JSON.stringify({ filename: "match.rofl" }),
        }),
      );
      expect(response.status).toBe(200);
      expect(mocks.createPendingUpload).toHaveBeenCalledExactlyOnceWith(
        mocks.token,
        expect.objectContaining({ role }),
      );
    },
  );
});

describe("login and route authorization", () => {
  it.each([
    [VIEWER_KEY, "admin", "/admin?view=all", "viewer", "/"],
    [VIEWER_KEY, "admin", "/admin/nested", "viewer", "/"],
    [VIEWER_KEY, "admin", "/games?page=2", "viewer", "/games?page=2"],
    [VIEWER_KEY, "admin", "//evil.test", "viewer", "/"],
    [VIEWER_KEY, "owner", "/", "viewer", "/"],
    [ADMIN_KEY, "viewer", "/", "admin", "/games"],
    [OWNER_KEY, "viewer", "/", "owner", "/games"],
    [ADMIN_KEY, "viewer", "/admin", "admin", "/admin"],
    [ADMIN_KEY, "owner", "/admin/audit", "admin", "/games"],
    [OWNER_KEY, "viewer", "/admin/audit", "owner", "/admin/audit"],
  ])(
    "uses the matching key for role and safe redirect to %s",
    async (key, submittedRole, redirectTo, role, destination) => {
      await expect(
        login(null, form({ password: key, role: submittedRole, redirectTo })),
      ).rejects.toThrow(`redirect:${destination}`);
      const [cookie, token, options] = mocks.setCookie.mock.calls[0];
      expect(cookie).toBe(SESSION_COOKIE);
      expect((await readSessionToken(token))?.role).toBe(role);
      expect(options).toMatchObject({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_MAX_AGE_SECONDS,
      });
    },
  );

  it.each([
    [VIEWER_KEY, "/"],
    [ADMIN_KEY, "/games"],
    [OWNER_KEY, "/games"],
  ])(
    "chooses the role's landing when no destination is supplied",
    async (key, destination) => {
      await expect(login(null, form({ password: key }))).rejects.toThrow(
        `redirect:${destination}`,
      );
    },
  );

  it("does not issue a session when authentication configuration is invalid", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    const result = await login(null, form({ password: VIEWER_KEY }));
    expect(result?.error).toContain("설정");
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it("preserves unauthenticated API 401 and login redirects", async () => {
    const api = await proxy(new NextRequest("http://localhost/api/uploads"));
    expect(api.status).toBe(401);
    const page = await proxy(new NextRequest("http://localhost/games?page=2"));
    expect(page.headers.get("location")).toBe(
      "http://localhost/login?redirectTo=%2Fgames%3Fpage%3D2",
    );
  });

  it.each(["/admin", "/admin/", "/admin/nested", "/upload"])(
    "redirects viewer requests for %s",
    async (path) => {
      mocks.token = await sessionToken("viewer");
      const response = await proxy(
        new NextRequest(`http://localhost${path}`, {
          headers: { cookie: `${SESSION_COOKIE}=${mocks.token}` },
        }),
      );
      expect(response.headers.get("location")).toBe("http://localhost/members");
    },
  );

  it.each(["viewer", "admin"] as const)(
    "blocks %s audit paths at Proxy",
    async (role) => {
      mocks.token = await sessionToken(role);
      for (const path of ["/admin/audit", "/admin/audit/nested"]) {
        const response = await proxy(
          new NextRequest(`http://localhost${path}`, {
            headers: { cookie: `${SESSION_COOKIE}=${mocks.token}` },
          }),
        );
        expect(response.headers.get("location")).toBe(
          "http://localhost/members",
        );
      }
    },
  );

  it.each(["admin", "owner"] as const)(
    "allows %s read and upload paths",
    async (role) => {
      mocks.token = await sessionToken(role);
      for (const path of [
        "/members",
        "/games?view=excluded",
        "/upload",
        "/api/uploads",
        "/api/blob/upload",
        "/api/process",
        "/administrator",
      ]) {
        const response = await proxy(
          new NextRequest(`http://localhost${path}`, {
            headers: { cookie: `${SESSION_COOKIE}=${mocks.token}` },
          }),
        );
        expect(response.headers.get("x-middleware-next")).toBe("1");
      }
    },
  );

  it("checks the admin page before any management query without relying on Proxy", async () => {
    await expect(AdminPage()).rejects.toThrow(
      "redirect:/login?redirectTo=%2Fadmin",
    );
    mocks.token = await sessionToken("viewer");
    await expect(AdminPage()).rejects.toThrow("redirect:/members");
    expect(mocks.listMembers).not.toHaveBeenCalled();
    expect(mocks.listUnlinked).not.toHaveBeenCalled();
    mocks.token = await sessionToken("admin");
    expect(renderToStaticMarkup(await AdminPage())).toContain("모임원 추가");
    expect(mocks.listMembers).toHaveBeenCalledOnce();
    expect(mocks.listUnlinked).toHaveBeenCalledOnce();
  });
});

describe("verified role visibility", () => {
  it("renders separate champion rows with localized and unknown positions", async () => {
    mocks.token = await sessionToken("viewer");
    const member = { id: randomUUID(), name: "포지션 모임원", birthYear: null };
    const stats = {
      totalGames: 1,
      wins: 1,
      losses: 0,
      undecided: 0,
      winRate: 100,
      averageKills: 2,
      averageDeaths: 3,
      averageAssists: 4,
    };
    mocks.getMemberHistory.mockResolvedValue({
      member,
      accounts: [],
      stats: { ...stats, totalGames: 3 },
      championStats: ["MIDDLE", "UTILITY", null].map((position) => ({
        ...stats,
        champion: "Ahri",
        position,
      })),
      positionStats: [
        { position: "MIDDLE", totalGames: 2, winRate: 50 },
        { position: "UTILITY", totalGames: 1, winRate: 100 },
        { position: null, totalGames: 1, winRate: null },
      ],
      games: [],
    });
    const html = renderToStaticMarkup(
      await MemberHistoryPage({
        params: Promise.resolve({ id: member.id }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(html).toContain('<th scope="col">포지션</th>');
    for (const label of ["미드", "서폿", "불명"]) {
      expect(html).toContain(
        `<th scope="row">Ahri</th><td>${label}</td><td>1경기</td>`,
      );
    }
    expect(html.match(/<th scope="row">Ahri<\/th>/g)).toHaveLength(3);
    expect(html).toContain('<th scope="col">플레이 횟수</th>');
    expect(html).toContain(
      '<th scope="row">미드</th><td>2회</td><td>50.0%</td>',
    );
    expect(html).toContain(
      '<th scope="row">서폿</th><td>1회</td><td>100.0%</td>',
    );
    expect(html).toContain('<th scope="row">불명</th><td>1회</td><td>—</td>');
    expect(html.indexOf("플레이한 챔피언")).toBeLessThan(
      html.indexOf("플레이 포지션"),
    );
    expect(html.indexOf("플레이 포지션")).toBeLessThan(
      html.indexOf("연결된 라이엇 계정"),
    );
  });

  it.each(["viewer", "admin", "owner"] as const)(
    "restricts member management links for %s, including empty and ambiguous records",
    async (role) => {
      mocks.token = await sessionToken(role);
      const member = {
        id: randomUUID(),
        name: "조회 모임원",
        birthYear: null,
        accounts: [],
      };
      for (const members of [[], [member]]) {
        mocks.listMembers.mockResolvedValue(members);
        const html = renderToStaticMarkup(await MembersPage());
        expect(html).toContain("모임원 정보");
        expect(html.includes('href="/admin"')).toBe(role !== "viewer");
      }
      mocks.getMemberHistory.mockResolvedValue({
        member,
        accounts: [],
        stats: {
          totalGames: 1,
          wins: 0,
          losses: 0,
          undecided: 1,
          winRate: null,
          averageKills: null,
          averageDeaths: null,
          averageAssists: null,
        },
        championStats: [],
        positionStats: [],
        games: [
          {
            ...GAME,
            result: "unknown",
            ambiguous: true,
            champion: null,
            position: null,
            kills: null,
            deaths: null,
            assists: null,
          },
        ],
      });
      const html = renderToStaticMarkup(
        await MemberHistoryPage({
          params: Promise.resolve({ id: member.id }),
          searchParams: Promise.resolve({}),
        }),
      );
      expect(html).toContain(
        role === "viewer" ? "조****원의 전적" : "조회 모임원의 전적",
      );
      expect(html).toContain("계정 중복 연결 확인");
      expect(html).toContain("집계할 포지션 전적이 없습니다.");
      expect(html.includes('href="/admin"')).toBe(role !== "viewer");
    },
  );

  it.each(["viewer", "admin", "owner"] as const)(
    "renders navigation for %s",
    async (role) => {
      mocks.token = await sessionToken(role);
      const html = renderToStaticMarkup(
        await AppLayout({ children: <p>조회 내용</p> }),
      );
      expect(html).toContain(
        role === "owner"
          ? "서비스 오너"
          : role === "admin"
            ? "관리자"
            : "일반 사용자",
      );
      expect(html.includes('href="/admin"')).toBe(role !== "viewer");
      expect(html).toContain('href="/members"');
      expect(html.includes('href="/upload"')).toBe(role !== "viewer");
      expect(html).toContain('href="/games"');
    },
  );

  it.each(["viewer", "admin", "owner"] as const)(
    "renders game reads and restricts controls for %s",
    async (role) => {
      mocks.token = await sessionToken(role);
      for (const excluded of [false, true]) {
        mocks.getGameDetail.mockResolvedValue({
          ...GAME,
          excludedAt: excluded ? new Date() : null,
        });
        const html = renderToStaticMarkup(
          await GameDetailPage({
            params: Promise.resolve({ id: GAME_ID }),
            searchParams: Promise.resolve({}),
          }),
        );
        expect(html).toContain("게임 상세");
        expect(html.includes('data-management="date"')).toBe(role !== "viewer");
        expect(
          html.includes(
            `data-management="${excluded ? "restore" : "exclude"}"`,
          ),
        ).toBe(role !== "viewer");
      }
      const list = renderToStaticMarkup(
        await GamesPage({
          searchParams: Promise.resolve({ view: "excluded" }),
        }),
      );
      expect(list).toContain("상세");
      expect(list.includes('data-management="restore"')).toBe(
        role !== "viewer",
      );
    },
  );
});
