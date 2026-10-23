import "server-only";

import type { PendingUpload } from "@/db/schema";
import { canUpload } from "@/lib/capabilities";
import type { Actor } from "@/lib/auth";

export function matchesUploadActor(
  row: PendingUpload | null,
  actor: Actor,
): boolean {
  return (
    !!row &&
    (row.channel ?? "browser") === "browser" &&
    canUpload(actor.role) &&
    row.actorRole === actor.role &&
    row.actorAccountId === actor.accountId &&
    row.actorAdminGrantId === actor.adminGrantId &&
    (row.actorUploaderGrantId ?? null) === (actor.uploaderGrantId ?? null)
  );
}
