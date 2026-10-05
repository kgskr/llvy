import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { requestBudgets } from "@/db/schema";

type Budget = { key: string; limit: number; windowMs: number };

class BudgetExceeded extends Error {}

/** Hash client identifiers so the budget table does not retain raw IPs or cookies. */
export function budgetKey(scope: string, identity: string): string {
  return `${scope}:${createHash("sha256").update(identity).digest("hex")}`;
}

/** All budgets are consumed atomically. A rejected request consumes none. */
export async function consumeRequestBudgets(
  budgets: Budget[],
): Promise<boolean> {
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      for (const budget of budgets) {
        const resetAt = new Date(now.getTime() + budget.windowMs);
        const rows = await tx
          .insert(requestBudgets)
          .values({ key: budget.key, count: 1, resetAt })
          .onConflictDoUpdate({
            target: requestBudgets.key,
            set: {
              count: sql`case when ${requestBudgets.resetAt} <= ${now} then 1 else least(${requestBudgets.count} + 1, ${budget.limit + 1}) end`,
              resetAt: sql`case when ${requestBudgets.resetAt} <= ${now} then ${resetAt} else ${requestBudgets.resetAt} end`,
            },
            // Once exhausted, avoid rewriting the hot row for every rejection.
            setWhere: sql`${requestBudgets.resetAt} <= ${now} or ${requestBudgets.count} < ${budget.limit}`,
          })
          .returning({ count: requestBudgets.count });
        if (rows.length === 0 || rows[0].count > budget.limit) {
          throw new BudgetExceeded();
        }
      }
    });
    return true;
  } catch (error) {
    if (error instanceof BudgetExceeded) return false;
    throw error;
  }
}
