import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertOwner: vi.fn(),
  grant: vi.fn(),
  revoke: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/session", () => ({
  assertOwner: mocks.assertOwner,
  UnauthorizedError: class UnauthorizedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));
vi.mock("@/lib/account-administration", () => ({
  grantAdministrator: mocks.grant,
  revokeAdministrator: mocks.revoke,
  GrantConflictError: class GrantConflictError extends Error {},
  AccountNotFoundError: class AccountNotFoundError extends Error {},
  AccountIneligibleError: class AccountIneligibleError extends Error {},
}));

import { ForbiddenError, UnauthorizedError } from "@/lib/session";
import {
  GrantConflictError,
  AccountNotFoundError,
} from "@/lib/account-administration";
import { grantAdminAction, revokeAdminAction } from "./owner-actions";

const ACCOUNT_ID = "c1c1eb6e-1ef5-48e1-95da-51454965df91";
const KEY = "Aa1bcDeF2ghiJkL3";

function form(accountId = ACCOUNT_ID) {
  const data = new FormData();
  data.set("accountId", accountId);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.assertOwner.mockResolvedValue({ role: "owner" });
  mocks.grant.mockResolvedValue(ACCOUNT_ID);
  mocks.revoke.mockResolvedValue(true);
});

describe("owner account permission Actions", () => {
  it("returns the new assignment without credentials from successful grant and refreshes owner screens", async () => {
    expect(await grantAdminAction(null, form())).toMatchObject({
      status: "success",
      administrator: true,
    });
    expect(mocks.grant).toHaveBeenCalledExactlyOnceWith(ACCOUNT_ID);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/users");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/audit");
  });

  it.each([ForbiddenError, UnauthorizedError])(
    "blocks a direct invocation before account mutation",
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

  it("rejects malformed identifiers before account services", async () => {
    for (const action of [grantAdminAction, revokeAdminAction]) {
      expect((await action(null, form("invalid"))).status).toBe("error");
    }
    expect(mocks.grant).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it.each([GrantConflictError, AccountNotFoundError])(
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
    expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith(ACCOUNT_ID);
  });

  it("handles already revoked credentials without claiming a fresh revocation", async () => {
    mocks.revoke.mockResolvedValue(false);
    expect((await revokeAdminAction(null, form())).status).toBe("success");
  });

  it("provides recovery feedback without exposing service errors or plaintext", async () => {
    mocks.grant.mockRejectedValue(new Error(`database detail ${KEY}`));
    const result = await grantAdminAction(null, form());
    expect(result.status).toBe("error");
    expect(result.message).toContain("목록을 새로고침");
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain("database detail");
  });
});
