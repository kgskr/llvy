"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { approveAuthorization } from "@/lib/desktop/auth-store";
import { checkCsrf } from "@/lib/desktop/browser";
import { DesktopError } from "@/lib/desktop/protocol";

export async function submitConnection(requestId: string, form: FormData) {
  const current = await getSession();
  if (!current) redirect("/login");
  await checkCsrf(current, "connect:" + requestId, form.get("csrf"));
  const decision = form.get("decision");
  if (decision !== "approve" && decision !== "deny")
    throw new DesktopError("invalid_request");
  const replacement = form.get("replacement");
  const callback = await approveAuthorization(
    current,
    requestId,
    decision,
    typeof replacement === "string" && replacement ? replacement : undefined,
  );
  redirect(callback ?? "/desktop/devices");
}
