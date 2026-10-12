import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { discordApiControls } from "@/db/schema";

export class DiscordUnavailableError extends Error {
  constructor(public retryAfterSeconds = 60) {
    super("Discord confirmation is temporarily unavailable");
    this.name = "DiscordUnavailableError";
  }
}
/** Local capacity exhaustion is not a failed Discord request or recovery probe. */
export class DiscordBusyError extends DiscordUnavailableError {
  constructor() {
    super(1);
    this.name = "DiscordBusyError";
  }
}
export type BotPermit = {
  owner: string;
  globalKey: string;
  guildKey: string;
  versions: { key: string; version: number; recovering: boolean }[];
};
export function circuitKeys(clientId: string, guildId: string) {
  const scope =
    (process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "local") +
    ":" +
    clientId;
  return {
    globalKey: "discord:" + scope + ":bot",
    guildKey: "discord:" + scope + ":guild:" + guildId,
  };
}
/** Avoid even OAuth exchange when bot admission is already known to be blocked. */
export async function ensureBotNotBlocked(clientId: string, guildId: string) {
  const keys = circuitKeys(clientId, guildId);
  const rows = await db
    .select({ until: discordApiControls.blockedUntil })
    .from(discordApiControls)
    .where(inArray(discordApiControls.key, [keys.globalKey, keys.guildKey]));
  const until = rows.reduce(
    (max, row) => Math.max(max, row.until?.getTime() ?? 0),
    0,
  );
  if (until > Date.now())
    throw new DiscordUnavailableError(
      Math.max(1, Math.ceil((until - Date.now()) / 1000)),
    );
}
/** A shared expiring single-call permit also bounds in-flight bot concurrency. */
export async function acquireBotPermit(
  clientId: string,
  guildId: string,
  deadline = Date.now() + 10_000,
): Promise<BotPermit> {
  for (;;) {
    const permit = await tryAcquireBotPermit(clientId, guildId, deadline);
    if (permit) return permit;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new DiscordBusyError();
    // The transaction has ended: neither polling nor provider I/O holds row locks.
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(50 + Math.random() * 50, remaining)),
    );
  }
}
async function tryAcquireBotPermit(
  clientId: string,
  guildId: string,
  deadline: number,
): Promise<BotPermit | null> {
  const keys = circuitKeys(clientId, guildId);
  const ordered = [keys.globalKey, keys.guildKey].sort();
  return db.transaction(async (tx) => {
    for (const key of ordered)
      await tx.insert(discordApiControls).values({ key }).onConflictDoNothing();
    const rows = await tx
      .select()
      .from(discordApiControls)
      .where(inArray(discordApiControls.key, ordered))
      .orderBy(asc(discordApiControls.key))
      .for("update");
    const now = Date.now();
    const blocked = rows.reduce(
      (deadline, row) => Math.max(deadline, row.blockedUntil?.getTime() ?? 0),
      0,
    );
    if (blocked > now)
      throw new DiscordUnavailableError(
        Math.max(1, Math.ceil((blocked - now) / 1000)),
      );
    if (now >= deadline) throw new DiscordBusyError();
    const global = rows.find((row) => row.key === keys.globalKey)!;
    if (global.probeUntil && global.probeUntil.getTime() > now) return null;
    const owner = crypto.randomUUID();
    await tx
      .update(discordApiControls)
      .set({ probeOwner: owner, probeUntil: new Date(now + 20_000) })
      .where(eq(discordApiControls.key, keys.globalKey));
    return {
      ...keys,
      owner,
      versions: rows.map((row) => ({
        key: row.key,
        version: row.version,
        recovering: row.reason !== null,
      })),
    };
  });
}
/** Recheck after preparation so a stalled worker cannot use an expired permit. */
export async function renewBotPermit(permit: BotPermit): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(discordApiControls)
      .where(
        inArray(
          discordApiControls.key,
          [permit.globalKey, permit.guildKey].sort(),
        ),
      )
      .orderBy(asc(discordApiControls.key))
      .for("update");
    const now = Date.now();
    const global = rows.find((row) => row.key === permit.globalKey);
    if (
      !global ||
      global.probeOwner !== permit.owner ||
      !global.probeUntil ||
      global.probeUntil.getTime() <= now ||
      rows.some(
        (row) =>
          (row.blockedUntil?.getTime() ?? 0) > now ||
          permit.versions.find((version) => version.key === row.key)
            ?.version !== row.version,
      )
    )
      throw new DiscordUnavailableError();
    await tx
      .update(discordApiControls)
      .set({ probeUntil: new Date(now + 20_000) })
      .where(eq(discordApiControls.key, permit.globalKey));
  });
}

export async function finishBotPermit(
  permit: BotPermit,
  outcome: {
    healthy: boolean;
    attempted?: boolean;
    block?: { scope: "global" | "guild"; reason: string; waitMs: number };
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const keys = [permit.globalKey, permit.guildKey].sort();
    await tx
      .select({ key: discordApiControls.key })
      .from(discordApiControls)
      .where(inArray(discordApiControls.key, keys))
      .orderBy(asc(discordApiControls.key))
      .for("update");
    if (outcome.healthy)
      for (const row of permit.versions) {
        await tx
          .update(discordApiControls)
          .set({ reason: null, blockedUntil: null })
          .where(
            and(
              eq(discordApiControls.key, row.key),
              eq(discordApiControls.version, row.version),
            ),
          );
      }
    const block =
      outcome.block ??
      (!outcome.healthy &&
      outcome.attempted !== false &&
      permit.versions.some((row) => row.recovering)
        ? {
            scope: "global" as const,
            reason: "probe_unavailable",
            waitMs: 60_000,
          }
        : undefined);
    if (block) {
      const until = new Date(Date.now() + block.waitMs);
      await tx
        .update(discordApiControls)
        .set({
          reason: block.reason,
          blockedUntil: sql`greatest(${discordApiControls.blockedUntil}, ${until})`,
          version: sql`${discordApiControls.version} + 1`,
        })
        .where(
          eq(
            discordApiControls.key,
            block.scope === "global" ? permit.globalKey : permit.guildKey,
          ),
        );
    }
    await tx
      .update(discordApiControls)
      .set({ probeOwner: null, probeUntil: null })
      .where(
        and(
          eq(discordApiControls.key, permit.globalKey),
          eq(discordApiControls.probeOwner, permit.owner),
        ),
      );
  });
}
