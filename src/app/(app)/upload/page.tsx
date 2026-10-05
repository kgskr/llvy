import { redirect } from "next/navigation";

import { assertAdmin, ForbiddenError, UnauthorizedError } from "@/lib/session";

import UploadForm from "./upload-form";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  try {
    await assertAdmin();
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect("/login");
    if (error instanceof ForbiddenError) redirect("/games");
    throw error;
  }
  return <UploadForm />;
}
