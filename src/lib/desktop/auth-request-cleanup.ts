import "server-only";
import { and, asc, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { desktopAuthRequests } from "@/db/schema";

/** Delete expired requests only; simultaneous workers claim disjoint batches. */
export async function cleanupExpiredAuthorizationRequests(limit: 10 | 500) {
  const now = new Date();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: desktopAuthRequests.id })
      .from(desktopAuthRequests)
      .where(lte(desktopAuthRequests.expiresAt, now))
      .orderBy(asc(desktopAuthRequests.expiresAt), asc(desktopAuthRequests.id))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (!rows.length) return 0;
    const deleted = await tx
      .delete(desktopAuthRequests)
      .where(
        and(
          inArray(
            desktopAuthRequests.id,
            rows.map((row) => row.id),
          ),
          lte(desktopAuthRequests.expiresAt, now),
        ),
      )
      .returning({ id: desktopAuthRequests.id });
    return deleted.length;
  });
}
