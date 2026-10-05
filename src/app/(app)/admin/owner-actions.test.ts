import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertOwner: vi.fn(),
  grant: vi.fn(),
  revoke: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/session", () => ({
  assertOwner: mocks.assertOwner,
  UnauthorizedError: class UnauthorizedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));
vi.mock("@/lib/admin-credentials", () => ({
  grantAdminCredential: mocks.grant,
  revokeAdminCredential: mocks.revoke,
  CredentialConflictError: class CredentialConflictError extends Error {},
  MemberNotFoundError: class MemberNotFoundError extends Error {},
}));

import { ForbiddenError, UnauthorizedError } from "@/lib/session";
import {
  CredentialConflictError,
  MemberNotFoundError,
} from "@/lib/admin-credentials";
import { grantAdminAction, revokeAdminAction } from "./owner-actions";

const MEMBER_ID = "c1c1eb6e-1ef5-48e1-95da-51454965df91";
const KEY = "Aa1bcDeF2ghiJkL3";

function form(memberId = MEMBER_ID) {
  const data = new FormData();
  data.set("memberId", memberId);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.assertOwner.mockResolvedValue({ role: "owner" });
  mocks.grant.mockResolvedValue({ key: KEY, credentialId: MEMBER_ID });
  mocks.revoke.mockResolvedValue(true);
});

describe("owner credential Actions", () => {
  it("returns plaintext only from successful initial grant and refreshes owner screens", async () => {
    expect(await grantAdminAction(null, form())).toMatchObject({
      status: "success",
      administrator: true,
      key: KEY,
    });
    expect(mocks.grant).toHaveBeenCalledExactlyOnceWith(MEMBER_ID);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/audit");
  });

  it.each([ForbiddenError, UnauthorizedError])(
    "blocks a direct invocation before credential mutation",
    async (ErrorType) => {
      mocks.assertOwner.mockRejectedValue(new ErrorType());
      for (const action of [grantAdminAction, revokeAdminAction]) {
        const result = await action(null, form());
        expect(result.status).toBe("error");
        expect(result).not.toHaveProperty("key");
      }
      expect(mocks.grant).not.toHaveBeenCalled();
      expect(mocks.revoke).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed identifiers before credential services", async () => {
    for (const action of [grantAdminAction, revokeAdminAction]) {
      expect((await action(null, form("invalid"))).status).toBe("error");
    }
    expect(mocks.grant).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it.each([CredentialConflictError, MemberNotFoundError])(
    "does not redisplay a key after rejected issuance",
    async (ErrorType) => {
      mocks.grant.mockRejectedValue(new ErrorType());
      const result = await grantAdminAction(
        { status: "success", message: "previous" },
        form(),
      );
      expect(result.status).toBe("error");
      expect(result).not.toHaveProperty("key");
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("reports revocation and returns no plaintext", async () => {
    const result = await revokeAdminAction(null, form());
    expect(result).toMatchObject({ status: "success", administrator: false });
    expect(result).not.toHaveProperty("key");
    expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith(MEMBER_ID);
  });

  it("handles already revoked credentials without claiming a fresh revocation", async () => {
    mocks.revoke.mockResolvedValue(false);
    expect((await revokeAdminAction(null, form())).message).toContain("이미");
  });

  it("provides recovery feedback without exposing service errors or plaintext", async () => {
    mocks.grant.mockRejectedValue(new Error(`database detail ${KEY}`));
    const result = await grantAdminAction(null, form());
    expect(result.status).toBe("error");
    expect(result.message).toContain("지정 취소 후 다시 지정");
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain("database detail");
  });
});
