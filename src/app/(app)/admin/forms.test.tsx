import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({
  createMemberAction: vi.fn(),
  updateMemberAction: vi.fn(),
  deleteMemberAction: vi.fn(),
  linkAccountAction: vi.fn(),
  unlinkAccountAction: vi.fn(),
}));

import {
  AdminFeedbackProvider,
  DeleteMemberForm,
  LinkAccountForm,
} from "./forms";

describe("administration forms", () => {
  it("requires explicit confirmation before permanent deletion and explains the retained history", () => {
    const html = renderToStaticMarkup(
      <AdminFeedbackProvider>
        <DeleteMemberForm memberId="member-reference" memberName="김회원" />
      </AdminFeedbackProvider>,
    );
    expect(html).toContain('name="memberId" value="member-reference"');
    const confirmation = html.match(/<input[^>]+type="checkbox"[^>]*>/)?.[0];
    expect(confirmation).toContain('name="confirmed"');
    expect(confirmation).toContain('value="yes"');
    expect(confirmation).toContain('required=""');
    expect(confirmation).not.toContain('checked=""');
    const button = html.match(
      /<button[^>]+aria-label="김회원 영구 삭제"[^>]*>/,
    )?.[0];
    expect(button).toContain('disabled=""');
    expect(html).toContain("영구 삭제를 확인했습니다.");
    expect(html).toContain("김회원 모임원을 영구 삭제합니다.");
    expect(html).toContain("연결된 라이엇 계정은 미연결 상태로 돌아갑니다.");
    expect(html).toContain("게임·라이엇 계정·감사 기록은 보존됩니다.");
  });

  it("renders all supplied member options independently of paginated member rows", () => {
    const options = Array.from({ length: 25 }, (_, index) => ({
      id: `member-${index}`,
      name: `모임원 ${index}`,
    }));
    const html = renderToStaticMarkup(
      <LinkAccountForm
        accountId="account-reference"
        accountName="Player#KR1"
        members={options}
      />,
    );
    expect(html.match(/<option /g)).toHaveLength(26);
    expect(html).toContain('<option value="member-24">모임원 24</option>');
    expect(html).toContain('aria-label="Player#KR1 계정을 연결할 모임원"');
  });
});
