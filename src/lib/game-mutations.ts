import "server-only";

import { eq, sql } from "drizzle-orm";
import { games } from "@/db/schema";
import { appendAudit, withActorTransaction } from "@/lib/audit";
import { assertAdmin } from "@/lib/session";
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
  playedAt: Date | null,
): Promise<boolean> {
  const actor = await assertAdmin();
  if (
    !isUuid(id) ||
    (playedAt !== null &&
      (!(playedAt instanceof Date) || !Number.isFinite(playedAt.getTime())))
  )
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
        playedAtOverride: before.playedAtOverride?.toISOString() ?? null,
      },
      after: { playedAtOverride: playedAt?.toISOString() ?? null },
    });
    return true;
  });
}
