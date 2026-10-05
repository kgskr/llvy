import "server-only";

import { eq, sql } from "drizzle-orm";
import { games } from "@/db/schema";
import { appendAudit, withActorTransaction } from "@/lib/audit";
import { assertAdmin } from "@/lib/session";
import { validateGameDateInput } from "@/lib/game-date";
import { validateGameComment } from "@/lib/game-comment";
import { isUuid } from "@/lib/validation";

export async function setGameExcluded(
  id: string,
  excluded: boolean,
): Promise<boolean> {
  const actor = await assertAdmin();
  return withActorTransaction(actor, async (tx) => {
    const [before] = await tx
      .select({ excludedAt: games.excludedAt })
      .from(games)
      .where(eq(games.id, id))
      .for("update");
    if (!before) return false;
    const [after] = await tx
      .update(games)
      .set({
        excludedAt: excluded ? sql`coalesce(${games.excludedAt}, now())` : null,
      })
      .where(eq(games.id, id))
      .returning({ excludedAt: games.excludedAt });
    await appendAudit(tx, actor, {
      action: excluded ? "game.excluded" : "game.restored",
      targetType: "game",
      targetId: id,
      before: { excludedAt: before.excludedAt?.toISOString() ?? null },
      after: { excludedAt: after.excludedAt?.toISOString() ?? null },
    });
    return true;
  });
}

export async function setGamePlayedAt(
  id: string,
  playedAt: string | null,
): Promise<boolean> {
  const actor = await assertAdmin();
  if (!isUuid(id) || (playedAt !== null && !validateGameDateInput(playedAt).ok))
    return false;
  return withActorTransaction(actor, async (tx) => {
    const [before] = await tx
      .select({ playedAtOverride: games.playedAtOverride })
      .from(games)
      .where(eq(games.id, id))
      .for("update");
    if (!before) return false;
    await tx
      .update(games)
      .set({ playedAtOverride: playedAt })
      .where(eq(games.id, id));
    await appendAudit(tx, actor, {
      action: playedAt ? "game.date_updated" : "game.date_restored",
      targetType: "game",
      targetId: id,
      before: {
        playedAtOverride: before.playedAtOverride,
      },
      after: { playedAtOverride: playedAt },
    });
    return true;
  });
}

export async function setGameComment(
  id: string,
  value: string,
): Promise<boolean> {
  const actor = await assertAdmin();
  const input = validateGameComment(value);
  if (!isUuid(id) || !input.ok) return false;
  return withActorTransaction(actor, async (tx) => {
    const [before] = await tx
      .select({ comment: games.comment })
      .from(games)
      .where(eq(games.id, id))
      .for("update");
    if (!before) return false;
    await tx
      .update(games)
      .set({ comment: input.comment })
      .where(eq(games.id, id));
    await appendAudit(tx, actor, {
      action: "game.comment_updated",
      targetType: "game",
      targetId: id,
      before,
      after: { comment: input.comment },
    });
    return true;
  });
}
