import "server-only";
import { and, asc, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { oauthLoginAttempts } from "@/db/schema";
import { isReference, randomReference } from "@/lib/auth";
import { hashReference } from "@/lib/auth-store";
import { authorizationUrl } from "@/lib/discord";
import { getBotConfig } from "@/lib/discord-config";
import { sanitizeRedirect } from "@/lib/redirect";

export const LOGIN_ATTEMPT_COOKIE = "llvy_oauth_binding";
export const LOGIN_ATTEMPT_SECONDS = 600;
const EXPIRED_ATTEMPTS_PER_START = 20;
export async function createLoginAttempt(redirectTo: string) {
  getBotConfig();
  const state = randomReference();
  const binding = randomReference();
  const url = authorizationUrl(state);
  await db.transaction(async (tx) => {
    const now = new Date();
    // Reclaim faster than starts can accumulate expired rows, even when daily
    // maintenance is delayed. Never wait on another start/callback's row locks.
    await tx
      .delete(oauthLoginAttempts)
      .where(
        inArray(
          oauthLoginAttempts.stateHash,
          tx
            .select({ hash: oauthLoginAttempts.stateHash })
            .from(oauthLoginAttempts)
            .where(lte(oauthLoginAttempts.expiresAt, now))
            .orderBy(
              asc(oauthLoginAttempts.expiresAt),
              asc(oauthLoginAttempts.stateHash),
            )
            .limit(EXPIRED_ATTEMPTS_PER_START)
            .for("update", { skipLocked: true }),
        ),
      );
    await tx.insert(oauthLoginAttempts).values({
      stateHash: hashReference(state),
      bindingHash: hashReference(binding),
      redirectTo: sanitizeRedirect(redirectTo),
      expiresAt: new Date(now.getTime() + LOGIN_ATTEMPT_SECONDS * 1000),
    });
  });
  return { url, binding };
}
export async function consumeLoginAttempt(state: unknown, binding: unknown) {
  if (!isReference(state) || !isReference(binding)) return null;
  const [attempt] = await db
    .update(oauthLoginAttempts)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(oauthLoginAttempts.stateHash, hashReference(state)),
        eq(oauthLoginAttempts.bindingHash, hashReference(binding)),
        gt(oauthLoginAttempts.expiresAt, new Date()),
        isNull(oauthLoginAttempts.consumedAt),
      ),
    )
    .returning({ redirectTo: oauthLoginAttempts.redirectTo });
  return attempt ?? null;
}
