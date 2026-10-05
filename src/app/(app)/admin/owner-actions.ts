"use server";

import { revalidatePath } from "next/cache";

import {
  CredentialConflictError,
  grantAdminCredential,
  MemberNotFoundError,
  revokeAdminCredential,
} from "@/lib/admin-credentials";
import { assertOwner, ForbiddenError, UnauthorizedError } from "@/lib/session";
import { isUuid } from "@/lib/validation";

export type OwnerActionState = {
  status: "success" | "error";
  message: string;
  administrator?: boolean;
} | null;

type OwnerActionResult = Exclude<OwnerActionState, null> & { key?: string };

async function runOwnerAction(
  formData: FormData,
  action: (memberId: string) => Promise<OwnerActionResult>,
): Promise<OwnerActionResult> {
  try {
    await assertOwner();
    const memberId = formData.get("memberId");
    if (!isUuid(memberId)) {
      return { status: "error", message: "대상 모임원을 확인하세요." };
    }
    return await action(memberId);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { status: "error", message: "서비스 오너 권한이 필요합니다." };
    }
    if (error instanceof UnauthorizedError) {
      return {
        status: "error",
        message: "로그인이 만료되었습니다. 다시 로그인하세요.",
      };
    }
    if (error instanceof CredentialConflictError) {
      return {
        status: "error",
        message: "이미 관리자입니다. 목록을 새로고침하세요.",
      };
    }
    if (error instanceof MemberNotFoundError) {
      return {
        status: "error",
        message: "모임원을 찾지 못했습니다. 목록을 새로고침하세요.",
      };
    }
    return {
      status: "error",
      message:
        "처리 결과를 확인하지 못했습니다. 목록을 새로고침하세요. 비밀키를 받지 못했다면 지정 취소 후 다시 지정하세요.",
    };
  }
}

export async function grantAdminAction(
  _previousState: OwnerActionState,
  formData: FormData,
): Promise<OwnerActionResult> {
  return runOwnerAction(formData, async (memberId) => {
    const { key } = await grantAdminCredential(memberId);
    revalidatePath("/admin");
    revalidatePath("/admin/audit");
    return {
      status: "success",
      message: "관리자로 지정했습니다. 비밀키를 지금 복사해 전달하세요.",
      administrator: true,
      key,
    };
  });
}

export async function revokeAdminAction(
  _previousState: OwnerActionState,
  formData: FormData,
): Promise<OwnerActionResult> {
  return runOwnerAction(formData, async (memberId) => {
    const revoked = await revokeAdminCredential(memberId);
    revalidatePath("/admin");
    revalidatePath("/admin/audit");
    return {
      status: "success",
      message: revoked
        ? "관리자 지정을 취소했습니다. 기존 비밀키와 로그인은 사용할 수 없습니다."
        : "이미 관리자 지정이 취소되어 있습니다.",
      administrator: false,
    };
  });
}
