import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAdmin: vi.fn(),
  createMember: vi.fn(),
  updateMember: vi.fn(),
  linkAccount: vi.fn(),
  unlinkAccount: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/member-mutations", () => ({
  createMember: mocks.createMember,
  updateMember: mocks.updateMember,
  linkAccount: mocks.linkAccount,
  unlinkAccount: mocks.unlinkAccount,
}));
vi.mock("@/lib/session", () => ({
  assertAdmin: mocks.assertAdmin,
  UnauthorizedError: class UnauthorizedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

import { UnauthorizedError } from "@/lib/session";
import {
  createMemberAction,
  linkAccountAction,
  unlinkAccountAction,
  updateMemberAction,
} from "./actions";

const MEMBER_ID = "c1c1eb6e-1ef5-48e1-95da-51454965df91";
const ACCOUNT_ID = "6f965f1e-3bbe-44d5-a358-b72c70965d6c";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.assertAdmin.mockResolvedValue(undefined);
  mocks.createMember.mockResolvedValue(MEMBER_ID);
  mocks.updateMember.mockResolvedValue(true);
  mocks.linkAccount.mockResolvedValue(true);
  mocks.unlinkAccount.mockResolvedValue(true);
});

describe("member administration actions", () => {
  it("creates a validated member and returns success feedback", async () => {
    const result = await createMemberAction(
      null,
      form({ name: "  길수  ", birthYear: "1995" }),
    );
    expect(result?.status).toBe("success");
    expect(mocks.createMember).toHaveBeenCalledWith("길수", 1995);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("rejects malformed birth years without a database write", async () => {
    const result = await createMemberAction(
      null,
      form({ name: "길수", birthYear: "1995junk" }),
    );
    expect(result?.status).toBe("error");
    expect(mocks.createMember).not.toHaveBeenCalled();
  });

  it("updates the existing member identity and invalidates historical detail pages", async () => {
    const result = await updateMemberAction(
      null,
      form({ memberId: MEMBER_ID, name: "길수 수정", birthYear: "" }),
    );
    expect(result?.status).toBe("success");
    expect(mocks.updateMember).toHaveBeenCalledWith(
      MEMBER_ID,
      "길수 수정",
      null,
    );
    expect(mocks.createMember).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/games/[id]", "page");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/members");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/members/[id]", "page");
  });

  it("reports a missing member instead of claiming the update succeeded", async () => {
    mocks.updateMember.mockResolvedValue(false);
    expect(
      (
        await updateMemberAction(
          null,
          form({ memberId: MEMBER_ID, name: "길수" }),
        )
      )?.status,
    ).toBe("error");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects invalid member and account identifiers before sending SQL", async () => {
    expect(
      (
        await updateMemberAction(
          null,
          form({ memberId: "invalid", name: "길수" }),
        )
      )?.status,
    ).toBe("error");
    expect(
      (
        await linkAccountAction(
          null,
          form({ accountId: ACCOUNT_ID, memberId: "invalid" }),
        )
      )?.status,
    ).toBe("error");
    expect(
      (await unlinkAccountAction(null, form({ accountId: "invalid" })))?.status,
    ).toBe("error");
    expect(mocks.updateMember).not.toHaveBeenCalled();
    expect(mocks.linkAccount).not.toHaveBeenCalled();
    expect(mocks.unlinkAccount).not.toHaveBeenCalled();
  });

  it("links and unlinks accounts with explicit success feedback", async () => {
    expect(
      (
        await linkAccountAction(
          null,
          form({ accountId: ACCOUNT_ID, memberId: MEMBER_ID }),
        )
      )?.status,
    ).toBe("success");
    expect(mocks.linkAccount).toHaveBeenCalledWith(ACCOUNT_ID, MEMBER_ID);
    expect(
      (await unlinkAccountAction(null, form({ accountId: ACCOUNT_ID })))
        ?.status,
    ).toBe("success");
    expect(mocks.unlinkAccount).toHaveBeenCalledWith(ACCOUNT_ID);
  });

  it("rejects all unauthenticated mutations without a database write", async () => {
    mocks.assertAdmin.mockRejectedValue(new UnauthorizedError());
    const data = form({
      memberId: MEMBER_ID,
      accountId: ACCOUNT_ID,
      name: "길수",
      birthYear: "1995",
    });
    for (const action of [
      createMemberAction,
      updateMemberAction,
      linkAccountAction,
      unlinkAccountAction,
    ]) {
      const result = await action(null, data);
      expect(result?.status).toBe("error");
      expect(result?.message).toContain("로그인");
    }
    expect(mocks.createMember).not.toHaveBeenCalled();
    expect(mocks.updateMember).not.toHaveBeenCalled();
    expect(mocks.linkAccount).not.toHaveBeenCalled();
    expect(mocks.unlinkAccount).not.toHaveBeenCalled();
  });

  it("provides retry feedback for database failures without leaking raw errors", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.createMember.mockRejectedValue(new Error("internal database detail"));
    try {
      const result = await createMemberAction(null, form({ name: "길수" }));
      expect(result?.status).toBe("error");
      expect(result?.message).not.toContain("internal database detail");
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
