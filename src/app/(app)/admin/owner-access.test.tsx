import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listMembers: vi.fn(),
  listUnlinked: vi.fn(),
  countMembers: vi.fn(),
  countUnlinked: vi.fn(),
  listMemberOptions: vi.fn(),
  listAssignments: vi.fn(),
  listAuditLogs: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (destination: string) => {
    throw new Error(`redirect:${destination}`);
  },
}));
vi.mock("@/lib/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/members", () => ({
  listMembersWithAccounts: mocks.listMembers,
  listUnlinkedAccounts: mocks.listUnlinked,
  countMembers: mocks.countMembers,
  countUnlinkedAccounts: mocks.countUnlinked,
  listMemberOptions: mocks.listMemberOptions,
}));
vi.mock("@/lib/admin-credentials", () => ({
  listAdminAssignments: mocks.listAssignments,
}));
vi.mock("@/lib/audit", () => ({ listAuditLogs: mocks.listAuditLogs }));
vi.mock("./forms", () => ({
  AdminFeedbackProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  MemberForm: () => <form data-management="member" />,
  LinkAccountForm: ({
    members,
  }: {
    members: { id: string; name: string }[];
  }) => (
    <select aria-label="account-members">
      {members.map((member) => (
        <option key={member.id} value={member.id}>
          {member.name}
        </option>
      ))}
    </select>
  ),
  UnlinkAccountForm: () => <form />,
  DeleteMemberForm: ({ memberId }: { memberId: string }) => (
    <form data-management="delete" data-member={memberId} />
  ),
}));
vi.mock("./credential-controls", () => ({
  CredentialControls: ({ administrator }: { administrator: boolean }) => (
    <div data-owner="credentials">
      {administrator ? "지정 취소" : "관리자로 지정"}
    </div>
  ),
}));

import AdminPage from "./page";
import AuditPage from "./audit/page";

const MEMBER_ID = "c1c1eb6e-1ef5-48e1-95da-51454965df91";
const audit = {
  id: "audit-id",
  occurredAt: new Date("2026-10-05T00:00:00Z"),
  actorName: "김길수",
  actorRole: "admin",
  actorMemberId: MEMBER_ID,
  actorCredentialId: "credential-id",
  action: "member.updated",
  targetType: "member",
  targetId: MEMBER_ID,
  result: "success",
  before: { name: "김길수", birthYear: 1995 },
  after: { name: "김수정", birthYear: null },
  requestId: "request-id",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSession.mockResolvedValue({ role: "owner" });
  mocks.listMembers.mockResolvedValue([
    {
      id: MEMBER_ID,
      name: "김길수",
      birthYear: 1995,
      accounts: [],
      administrator: false,
    },
  ]);
  mocks.listUnlinked.mockResolvedValue([]);
  mocks.countMembers.mockResolvedValue(1);
  mocks.countUnlinked.mockResolvedValue(0);
  mocks.listMemberOptions.mockResolvedValue([
    { id: MEMBER_ID, name: "김길수" },
  ]);
  mocks.listAssignments.mockResolvedValue([]);
  mocks.listAuditLogs.mockResolvedValue([audit]);
});

describe("owner-only management UI", () => {
  it("adds credential controls beside information editing and exposes the audit entry for owner", async () => {
    const html = renderToStaticMarkup(await AdminPage());
    expect(html).toContain("<th>정보 수정</th><th>관리자 권한</th>");
    expect(html).toContain('href="/admin/audit"');
    expect(html).toContain('data-owner="credentials"');
    expect(html).toContain("관리자로 지정");
    mocks.listMembers.mockResolvedValue([
      {
        id: MEMBER_ID,
        name: "김길수",
        birthYear: 1995,
        accounts: [],
        administrator: true,
      },
    ]);
    expect(renderToStaticMarkup(await AdminPage())).toContain("지정 취소");
  });

  it("preserves management for admin without querying or showing owner-only controls", async () => {
    mocks.getSession.mockResolvedValue({ role: "admin" });
    const html = renderToStaticMarkup(await AdminPage());
    expect(html).toContain("모임원 추가");
    expect(html).not.toContain("관리자 권한");
    expect(html).not.toContain('href="/admin/audit"');
    expect(html).not.toContain('data-owner="credentials"');
    expect(mocks.listAssignments).not.toHaveBeenCalled();
  });

  it.each([null, { role: "viewer" }])(
    "blocks protected management queries before rendering",
    async (session) => {
      mocks.getSession.mockResolvedValue(session);
      await expect(AdminPage()).rejects.toThrow("redirect:");
      expect(mocks.listMembers).not.toHaveBeenCalled();
      expect(mocks.listUnlinked).not.toHaveBeenCalled();
      expect(mocks.listAssignments).not.toHaveBeenCalled();
      expect(mocks.countMembers).not.toHaveBeenCalled();
      expect(mocks.countUnlinked).not.toHaveBeenCalled();
      expect(mocks.listMemberOptions).not.toHaveBeenCalled();
    },
  );
});

describe("protected deletion and independent administration pages", () => {
  it.each(["admin", "owner"])(
    "shows deletion for non-administrators and protects active administrators for %s",
    async (role) => {
      mocks.getSession.mockResolvedValue({ role });
      expect(renderToStaticMarkup(await AdminPage())).toContain(
        'data-management="delete"',
      );
      mocks.listMembers.mockResolvedValue([
        {
          id: MEMBER_ID,
          name: "김관리자",
          birthYear: 1995,
          accounts: [],
          administrator: true,
        },
      ]);
      const html = renderToStaticMarkup(await AdminPage());
      expect(html).not.toContain('data-management="delete"');
      expect(html).toContain("활성 관리자는 삭제할 수 없습니다.");
      expect(html).toContain("서비스 오너가 관리자 지정을 취소");
    },
  );

  it("fetches ten rows independently and preserves the other table's page in all links", async () => {
    mocks.countMembers.mockResolvedValue(35);
    mocks.countUnlinked.mockResolvedValue(45);
    const html = renderToStaticMarkup(
      await AdminPage({
        searchParams: Promise.resolve({ memberPage: "2", accountPage: "3" }),
      }),
    );
    expect(mocks.listMembers).toHaveBeenCalledExactlyOnceWith(10, 10);
    expect(mocks.listUnlinked).toHaveBeenCalledExactlyOnceWith(10, 20);
    expect(html).toContain("모임원 (35명)");
    expect(html).toContain("미연결 라이엇 계정 (45개)");
    for (const query of [
      "memberPage=1&amp;accountPage=3",
      "memberPage=3&amp;accountPage=3",
      "memberPage=2&amp;accountPage=2",
      "memberPage=2&amp;accountPage=4",
    ]) {
      expect(html).toContain(`href="/admin?${query}"`);
    }
  });

  it("clamps each requested page independently after totals shrink", async () => {
    mocks.countMembers.mockResolvedValue(10);
    mocks.countUnlinked.mockResolvedValue(11);
    const html = renderToStaticMarkup(
      await AdminPage({
        searchParams: Promise.resolve({ memberPage: "2", accountPage: "99" }),
      }),
    );
    expect(mocks.listMembers).toHaveBeenCalledExactlyOnceWith(10, 0);
    expect(mocks.listUnlinked).toHaveBeenCalledExactlyOnceWith(10, 10);
    expect(html).toContain("1 / 1페이지 · 총 10명");
    expect(html).toContain("2 / 2페이지 · 총 11개");
    expect(html).toContain('href="/admin?memberPage=1&amp;accountPage=1"');
  });

  it.each(["0", "-1", "2junk", "1.2", "9999999999999999999999999", ["1", "2"]])(
    "uses the first pages for malformed page parameters (%s)",
    async (value) => {
      await AdminPage({
        searchParams: Promise.resolve({
          memberPage: value,
          accountPage: value,
        }),
      });
      expect(mocks.listMembers).toHaveBeenCalledExactlyOnceWith(10, 0);
      expect(mocks.listUnlinked).toHaveBeenCalledExactlyOnceWith(10, 0);
    },
  );

  it("supplies every member as an account-link option even when absent from the current member page", async () => {
    const options = Array.from({ length: 25 }, (_, index) => ({
      id: `member-${index}`,
      name: `선택 모임원 ${index}`,
    }));
    mocks.countMembers.mockResolvedValue(25);
    mocks.countUnlinked.mockResolvedValue(1);
    mocks.listMemberOptions.mockResolvedValue(options);
    mocks.listUnlinked.mockResolvedValue([
      { id: "account-id", gameName: "Player", tagLine: "KR1", gameCount: 2 },
    ]);
    const html = renderToStaticMarkup(
      await AdminPage({ searchParams: Promise.resolve({ memberPage: "2" }) }),
    );
    expect(html).toContain('<option value="member-24">선택 모임원 24</option>');
    expect(html.match(/<option /g)).toHaveLength(25);
    expect(mocks.listMemberOptions).toHaveBeenCalledOnce();
    expect(mocks.listMembers).toHaveBeenCalledExactlyOnceWith(10, 10);
  });

  it("keeps both empty tables on valid first pages", async () => {
    mocks.countMembers.mockResolvedValue(0);
    mocks.countUnlinked.mockResolvedValue(0);
    mocks.listMembers.mockResolvedValue([]);
    mocks.listMemberOptions.mockResolvedValue([]);
    const html = renderToStaticMarkup(
      await AdminPage({
        searchParams: Promise.resolve({ memberPage: "99", accountPage: "99" }),
      }),
    );
    expect(html).toContain("아직 등록된 모임원이 없습니다.");
    expect(html).toContain("미연결 계정이 없습니다.");
    expect(mocks.listMembers).toHaveBeenCalledExactlyOnceWith(10, 0);
    expect(mocks.listUnlinked).toHaveBeenCalledExactlyOnceWith(10, 0);
  });
});

describe("owner-only audit page", () => {
  it("labels permanent member deletion and game comment changes", async () => {
    mocks.listAuditLogs.mockResolvedValue([
      { ...audit, action: "member.deleted", after: null },
      {
        ...audit,
        id: "comment-audit",
        action: "game.comment_updated",
        before: { comment: "이전 메모" },
        after: { comment: "새 메모" },
      },
    ]);
    const html = renderToStaticMarkup(
      await AuditPage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain("모임원 삭제");
    expect(html).toContain("게임 코멘트 수정");
    expect(html).toContain("코멘트: 이전 메모 → 새 메모");
  });
  it.each([null, { role: "viewer" }, { role: "admin" }])(
    "rejects non-owner access without querying logs",
    async (session) => {
      mocks.getSession.mockResolvedValue(session);
      await expect(
        AuditPage({ searchParams: Promise.resolve({}) }),
      ).rejects.toThrow("redirect:");
      expect(mocks.listAuditLogs).not.toHaveBeenCalled();
    },
  );

  it("renders attributed changes and correlation identifiers without modification controls", async () => {
    const html = renderToStaticMarkup(
      await AuditPage({ searchParams: Promise.resolve({}) }),
    );
    for (const text of [
      "김길수",
      "관리자",
      "모임원 정보 수정",
      "성공",
      "1995 → 없음",
      "김길수 → 김수정",
      "request-id",
      "credential-id",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("<form");
    expect(html).not.toContain("삭제");
    expect(mocks.listAuditLogs).toHaveBeenCalledExactlyOnceWith(51, 0);
  });

  it("bounds records to one page and provides previous/next navigation", async () => {
    mocks.listAuditLogs.mockResolvedValue(
      Array.from({ length: 51 }, (_, index) => ({
        ...audit,
        id: `audit-${index}`,
      })),
    );
    const html = renderToStaticMarkup(
      await AuditPage({ searchParams: Promise.resolve({ page: "2" }) }),
    );
    expect(mocks.listAuditLogs).toHaveBeenCalledExactlyOnceWith(51, 50);
    expect(html).toContain('href="/admin/audit?page=1"');
    expect(html).toContain('href="/admin/audit?page=3"');
    expect(html).not.toContain("audit-50");
  });

  it.each(["0", "2junk", "-1", "9999999999999999999999999", ["1", "2"]])(
    "uses first page for malformed pagination",
    async (page) => {
      await AuditPage({ searchParams: Promise.resolve({ page }) });
      expect(mocks.listAuditLogs).toHaveBeenCalledExactlyOnceWith(51, 0);
    },
  );

  it("shows unauthenticated login failures and an empty-state view", async () => {
    mocks.listAuditLogs.mockResolvedValue([
      {
        ...audit,
        action: "auth.login",
        result: "failure",
        actorName: null,
        actorRole: null,
        before: null,
        after: null,
      },
    ]);
    const html = renderToStaticMarkup(
      await AuditPage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain("인증되지 않은 사용자");
    expect(html).toContain("실패");
    mocks.listAuditLogs.mockResolvedValue([]);
    expect(
      renderToStaticMarkup(
        await AuditPage({ searchParams: Promise.resolve({}) }),
      ),
    ).toContain("표시할 감사로그가 없습니다.");
  });
});
