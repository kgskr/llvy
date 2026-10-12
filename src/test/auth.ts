import {
  createSessionToken,
  getAuthorityConfig,
  randomReference,
  type Actor,
} from "@/lib/auth";
import { createHash, randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { vi } from "vitest";
import { adminGrants, authAccounts, authSessions } from "@/db/schema";
import { db } from "@/test/database";
import { ownerActor, ownerSession } from "@/test/actor";

export function setTestAuthEnvironment() {
  vi.stubEnv(
    "AUTH_SECRET",
    "independent-discord-test-secret-at-least-32-bytes",
  );
  vi.stubEnv("DISCORD_GUILD_ID", "222222222222222222");
  vi.stubEnv("DISCORD_OWNER_USER_ID", ownerActor.discordUserId);
  vi.stubEnv("DISCORD_CLIENT_ID", "333333333333333333");
  vi.stubEnv("DISCORD_CLIENT_SECRET", "test-oauth-secret");
  vi.stubEnv("DISCORD_BOT_TOKEN", "test-bot-token");
  vi.stubEnv(
    "DISCORD_REDIRECT_URI",
    "http://localhost:3000/api/auth/discord/callback",
  );
}
export async function prepareOwnerFixture() {
  setTestAuthEnvironment();
  const { guildId } = getAuthorityConfig();
  await db.insert(authAccounts).values({
    id: ownerActor.accountId,
    discordUserId: ownerActor.discordUserId,
    username: "owner",
    displayName: ownerActor.name,
    guildId,
    membershipCheckedAt: new Date(),
  });
  await db.insert(authSessions).values({
    id: ownerActor.sessionId,
    accountId: ownerActor.accountId,
    guildId,
    referenceHash: createHash("sha256")
      .update(ownerSession.token)
      .digest("hex"),
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
  });
}
/** Fixture-only credentials. Production obtains identity and membership from Discord. */
export async function createTestSession(
  role: Actor["role"],
  options: { userId?: string; name?: string; accountId?: string } = {},
) {
  const config = getAuthorityConfig();
  const userId =
    options.userId ??
    (role === "owner"
      ? config.ownerUserId
      : String(randomInt(100_000_000, 999_999_999)));
  const name =
    options.name ??
    (role === "owner"
      ? "서비스 오너"
      : role === "admin"
        ? "김관리자"
        : "일반 사용자");
  await db
    .insert(authAccounts)
    .values({
      ...(options.accountId ? { id: options.accountId } : {}),
      discordUserId: userId,
      username: name,
      displayName: name,
      guildId: config.guildId,
      membershipCheckedAt: new Date(),
    })
    .onConflictDoNothing({ target: authAccounts.discordUserId });
  const [account] = await db
    .select()
    .from(authAccounts)
    .where(eq(authAccounts.discordUserId, userId));
  let adminGrantId: string | null = null;
  if (role === "admin") {
    const [issuer] = await db
      .select({ id: authAccounts.id })
      .from(authAccounts)
      .where(eq(authAccounts.discordUserId, config.ownerUserId));
    if (!issuer) throw new Error("Owner fixture is required");
    const [grant] = await db
      .insert(adminGrants)
      .values({ accountId: account.id, issuedBy: issuer.id })
      .returning({ id: adminGrants.id });
    adminGrantId = grant.id;
  }
  const reference = randomReference();
  const issuedAt = Date.now();
  const token = await createSessionToken(reference, issuedAt);
  const [session] = await db
    .insert(authSessions)
    .values({
      accountId: account.id,
      guildId: config.guildId,
      referenceHash: createHash("sha256").update(reference).digest("hex"),
      createdAt: new Date(issuedAt),
      expiresAt: new Date(issuedAt + 30 * 86_400_000),
    })
    .returning({ id: authSessions.id });
  return {
    role,
    accountId: account.id,
    discordUserId: userId,
    sessionId: session.id,
    adminGrantId,
    name,
    token,
    issuedAt,
  };
}
