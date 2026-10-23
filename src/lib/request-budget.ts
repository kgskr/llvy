import "server-only";

import { createHash } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import type { DbTransaction } from "@/lib/audit";
import { requestBudgets } from "@/db/schema";

export type Budget = { key: string; limit: number; windowMs: number };

export class BudgetExceeded extends Error {
  constructor(readonly resetAt?: Date) {
    super("Request budget exceeded");
  }
}

/** Hash client identifiers so the budget table does not retain raw IPs or cookies. */
export function budgetKey(scope: string, identity: string): string {
  return `${scope}:${createHash("sha256").update(identity).digest("hex")}`;
}

/** All budgets are consumed atomically. A rejected request consumes none. */
export async function consumeRequestBudgets(
  budgets: Budget[],
): Promise<boolean> {
  try {
    await db.transaction((tx) => consumeRequestBudgetsInTx(tx, budgets));
    return true;
  } catch (error) {
    if (error instanceof BudgetExceeded) return false;
    throw error;
  }
}

/** Throws on rejection: caller must let the transaction roll back all debits. */
export async function consumeRequestBudgetsInTx(
  tx: DbTransaction,
  budgets: Budget[],
) {
  const now = new Date();
  for (const budget of [...budgets].sort((a, b) =>
    a.key.localeCompare(b.key),
  )) {
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
      .returning({
        count: requestBudgets.count,
        resetAt: requestBudgets.resetAt,
      });
    if (rows.length === 0 || rows[0].count > budget.limit) {
      // A rejected ON CONFLICT update returns no row but keeps its row lock.
      // Read that existing window without extending it or committing any debit.
      const counter =
        rows[0] ??
        (
          await tx
            .select({ resetAt: requestBudgets.resetAt })
            .from(requestBudgets)
            .where(eq(requestBudgets.key, budget.key))
        )[0];
      throw new BudgetExceeded(counter?.resetAt);
    }
  }
}
