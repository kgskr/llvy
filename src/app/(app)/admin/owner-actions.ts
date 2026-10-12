"use server";
import { revalidatePath } from "next/cache";
import {
  AccountIneligibleError,
  AccountNotFoundError,
  GrantConflictError,
  grantAdministrator,
  revokeAdministrator,
} from "@/lib/account-administration";
import { assertOwner, ForbiddenError, UnauthorizedError } from "@/lib/session";
import { AuthConfigurationError } from "@/lib/auth";
import { DiscordUnavailableError } from "@/lib/discord-circuit";
import { isUuid } from "@/lib/validation";
export type OwnerActionState = {
  status: "success" | "error";
  message: string;
  administrator?: boolean;
} | null;
async function runOwnerAction(
  form: FormData,
  grant: boolean,
): Promise<Exclude<OwnerActionState, null>> {
  try {
    await assertOwner();
    const id = form.get("accountId");
    if (!isUuid(id))
      return { status: "error", message: "대상 사용자를 확인하세요." };
    if (grant) await grantAdministrator(id);
    else await revokeAdministrator(id);
    revalidatePath("/admin/users");
    revalidatePath("/admin/audit");
    return {
      status: "success",
      message: grant
        ? "관리자로 지정했습니다."
        : "관리자 지정을 취소했습니다. 기존 로그인은 사용할 수 없습니다.",
      administrator: grant,
    };
  } catch (error) {
    const message =
      error instanceof ForbiddenError
        ? "서비스 오너 권한이 필요합니다."
        : error instanceof UnauthorizedError
          ? "로그인이 만료되었습니다. 다시 로그인하세요."
          : error instanceof GrantConflictError
            ? "이미 관리자입니다. 목록을 새로고침하세요."
            : error instanceof AccountNotFoundError
              ? "사용자를 찾지 못했습니다. 목록을 새로고침하세요."
              : error instanceof AccountIneligibleError
                ? "활성 상태의 서버 멤버만 지정할 수 있습니다. 정지된 사용자는 다시 로그인해야 합니다."
                : error instanceof DiscordUnavailableError
                  ? "Discord 가입 여부를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요."
                  : error instanceof AuthConfigurationError
                    ? "로그인 설정에 문제가 있습니다. 운영자에게 문의하세요."
                    : "처리 결과를 확인하지 못했습니다. 목록을 새로고침하세요.";
    return { status: "error", message };
  }
}
export async function grantAdminAction(
  _previous: OwnerActionState,
  form: FormData,
) {
  return runOwnerAction(form, true);
}
export async function revokeAdminAction(
  _previous: OwnerActionState,
  form: FormData,
) {
  return runOwnerAction(form, false);
}
