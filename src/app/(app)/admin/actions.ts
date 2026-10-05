"use server";

import { revalidatePath } from "next/cache";

import {
  createMember,
  linkAccount,
  unlinkAccount,
  updateMember,
} from "@/lib/members";
import { assertAdmin, ForbiddenError, UnauthorizedError } from "@/lib/session";
import { isUuid, validateMemberInput } from "@/lib/validation";

type AdminActionResult = { status: "success" | "error"; message: string };
export type AdminActionState = AdminActionResult | null;

async function runAdminAction(
  action: () => Promise<AdminActionResult>,
): Promise<AdminActionResult> {
  try {
    await assertAdmin();
    return await action();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { status: "error", message: "관리자 권한이 필요합니다." };
    }
    if (error instanceof UnauthorizedError) {
      return {
        status: "error",
        message: "로그인이 만료되었습니다. 다시 로그인하세요.",
      };
    }
    console.error("Member administration failed", error);
    return {
      status: "error",
      message: "저장하지 못했습니다. 목록을 새로고침한 뒤 다시 시도하세요.",
    };
  }
}

function revalidateMembers() {
  revalidatePath("/admin");
  revalidatePath("/games");
  revalidatePath("/games/[id]", "page");
  revalidatePath("/members");
  revalidatePath("/members/[id]", "page");
}

export async function createMemberAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  return runAdminAction(async () => {
    const input = validateMemberInput(
      formData.get("name"),
      formData.get("birthYear"),
    );
    if (!input.ok) return { status: "error", message: input.error };
    await createMember(input.name, input.birthYear);
    revalidateMembers();
    return {
      status: "success",
      message: `${input.name} 모임원을 추가했습니다.`,
    };
  });
}

export async function updateMemberAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  return runAdminAction(async () => {
    const memberId = formData.get("memberId");
    if (!isUuid(memberId))
      return { status: "error", message: "수정할 모임원을 확인하세요." };
    const input = validateMemberInput(
      formData.get("name"),
      formData.get("birthYear"),
    );
    if (!input.ok) return { status: "error", message: input.error };
    if (!(await updateMember(memberId, input.name, input.birthYear))) {
      return {
        status: "error",
        message: "모임원을 찾지 못했습니다. 목록을 새로고침하세요.",
      };
    }
    revalidateMembers();
    return { status: "success", message: "모임원 정보를 저장했습니다." };
  });
}

export async function linkAccountAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  return runAdminAction(async () => {
    const accountId = formData.get("accountId");
    const memberId = formData.get("memberId");
    if (!isUuid(accountId) || !isUuid(memberId)) {
      return { status: "error", message: "연결할 계정과 모임원을 선택하세요." };
    }
    if (!(await linkAccount(accountId, memberId))) {
      return {
        status: "error",
        message: "계정을 찾지 못했습니다. 목록을 새로고침하세요.",
      };
    }
    revalidateMembers();
    return { status: "success", message: "라이엇 계정을 연결했습니다." };
  });
}

export async function unlinkAccountAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  return runAdminAction(async () => {
    const accountId = formData.get("accountId");
    if (!isUuid(accountId))
      return { status: "error", message: "연결을 해제할 계정을 확인하세요." };
    if (!(await unlinkAccount(accountId))) {
      return {
        status: "error",
        message: "계정을 찾지 못했습니다. 목록을 새로고침하세요.",
      };
    }
    revalidateMembers();
    return { status: "success", message: "라이엇 계정 연결을 해제했습니다." };
  });
}
