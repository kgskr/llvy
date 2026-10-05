import "server-only";

import type { PendingUpload } from "@/db/schema";
import type { Actor } from "@/lib/auth";

export function matchesUploadActor(
  row: PendingUpload | null,
  actor: Actor,
): boolean {
  return (
    !!row &&
    actor.role !== "viewer" &&
    row.actorRole === actor.role &&
    row.actorMemberId === actor.memberId &&
    row.actorCredentialId === actor.credentialId
  );
}
