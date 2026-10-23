"use server";

import { revalidatePath } from "next/cache";
import {
  grantUploader,
  revokeUploader,
  AccountIneligibleError,
  AccountNotFoundError,
  GrantConflictError,
} from "@/lib/account-administration";
import { assertAdmin, ForbiddenError, UnauthorizedError } from "@/lib/session";
import { DiscordUnavailableError } from "@/lib/discord-circuit";

export type UploaderActionState = {
  status: "success" | "error";
  message: string;
} | null;
async function change(
  accountId: FormDataEntryValue | null,
  grant: boolean,
): Promise<NonNullable<UploaderActionState>> {
  try {
    await assertAdmin();
    if (typeof accountId !== "string") throw new AccountNotFoundError();
    if (grant) await grantUploader(accountId);
    else await revokeUploader(accountId);
    revalidatePath("/admin/users");
    revalidatePath("/admin/audit");
    return {
      status: "success",
      message: grant
        ? "업로더 권한을 부여했습니다."
        : "업로더 권한을 회수했습니다. 기존 로그인과 기기 연결은 사용할 수 없습니다.",
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof ForbiddenError
          ? "관리자 또는 서비스 오너 권한이 필요합니다."
          : error instanceof UnauthorizedError
            ? "로그인이 만료되었습니다. 다시 로그인하세요."
            : error instanceof GrantConflictError
              ? "이미 권한이 부여된 사용자입니다. 목록을 새로고침하세요."
              : error instanceof AccountIneligibleError
                ? "대상 사용자의 역할과 가입 상태를 확인하세요. 관리자와 서비스 오너는 변경할 수 없습니다."
                : error instanceof AccountNotFoundError
                  ? "사용자를 찾지 못했습니다."
                  : error instanceof DiscordUnavailableError
                    ? "Discord 가입 여부를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요."
                    : "처리 결과를 확인하지 못했습니다. 목록을 새로고침하세요.",
    };
  }
}
export async function grantUploaderAction(
  _state: UploaderActionState,
  data: FormData,
) {
  return change(data.get("accountId"), true);
}
export async function revokeUploaderAction(
  _state: UploaderActionState,
  data: FormData,
) {
  return change(data.get("accountId"), false);
}
