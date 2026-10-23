import "server-only";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  authAccounts,
  authSessions,
  desktopAuthRequests,
  desktopCredentials,
  desktopSessions,
} from "@/db/schema";
import { getAuthorityConfig, type Actor } from "@/lib/auth";
import { appendAudit, type DbTransaction } from "@/lib/audit";
import { lockUploadAuthority, lockBrowserIdentity } from "@/lib/authority";
import { budgetKey, consumeRequestBudgets } from "@/lib/request-budget";
import { isUuid } from "@/lib/validation";
import { credentialActor, lockDevice } from "./authority";
import { revokeDevicesInTx } from "./revoke";
import { cleanupExpiredAuthorizationRequests } from "./auth-request-cleanup";
import {
  ACCESS_MS,
  CLIENT_ID,
  DesktopError,
  PERSISTENT_MS,
  PROTOCOL,
  SCOPES,
  TRANSIENT_MS,
  exactKeys,
  object,
  pkce,
  requireDesktop,
  secretHash,
  token,
  validToken,
  validateStart,
} from "./protocol";

async function authBudget(ip: string, device?: string, refresh = false) {
  const scope = device || refresh ? "refresh" : "authorization";
  const budgets = [
    {
      key: budgetKey("desktop:" + scope + ":ip", ip),
      limit: device || refresh ? 30 : 10,
      windowMs: 60_000,
    },
    {
      key: "desktop:" + scope + ":global",
      limit: device || refresh ? 300 : 100,
      windowMs: 60_000,
    },
  ];
  if (device)
    budgets.push({
      key: budgetKey("desktop:refresh:device", device),
      limit: 10,
      windowMs: 60_000,
    });
  if (!(await consumeRequestBudgets(budgets)))
    throw new DesktopError("rate_limited", 429, 60);
}
async function accountSessionLocks(tx: DbTransaction, accountId: string) {
  await tx
    .select({ id: authAccounts.id })
    .from(authAccounts)
    .where(eq(authAccounts.id, accountId))
    .for("update");
  await tx
    .select({ id: authSessions.id })
    .from(authSessions)
    .where(eq(authSessions.accountId, accountId))
    .orderBy(asc(authSessions.id))
    .for("update");
}
export async function startAuthorization(input: unknown, ip: string) {
  requireDesktop();
  const data = validateStart(input);
  await authBudget(ip);
  await cleanupExpiredAuthorizationRequests(10);
  const [row] = await db
    .insert(desktopAuthRequests)
    .values({ ...data, expiresAt: new Date(Date.now() + 10 * 60_000) })
    .returning({
      id: desktopAuthRequests.id,
      expiresAt: desktopAuthRequests.expiresAt,
    });
  return {
    protocol: PROTOCOL,
    requestId: row.id,
    approvalPath: "/desktop/connect?request=" + row.id,
    expiresAt: row.expiresAt.toISOString(),
  };
}
export async function connectionRequest(actor: Actor, id: string) {
  requireDesktop();
  if (!isUuid(id)) throw new DesktopError("invalid_request");
  return db.transaction(async (tx) => {
    await lockUploadAuthority(tx, actor);
    const [request] = await tx
      .select({
        id: desktopAuthRequests.id,
        mode: desktopAuthRequests.mode,
        expiresAt: desktopAuthRequests.expiresAt,
        status: desktopAuthRequests.status,
      })
      .from(desktopAuthRequests)
      .where(eq(desktopAuthRequests.id, id));
    if (
      !request ||
      request.status !== "pending" ||
      request.expiresAt.getTime() <= Date.now()
    )
      throw new DesktopError("request_expired", 410);
    return request;
  });
}
export async function approveAuthorization(
  actor: Actor,
  id: string,
  decision: "approve" | "deny",
  replacement?: string,
) {
  requireDesktop();
  if (!isUuid(id) || (replacement && !isUuid(replacement)))
    throw new DesktopError("invalid_request");
  return db.transaction(async (tx) => {
    await accountSessionLocks(tx, actor.accountId);
    await lockUploadAuthority(tx, actor);
    const [request] = await tx
      .select()
      .from(desktopAuthRequests)
      .where(eq(desktopAuthRequests.id, id))
      .for("update");
    if (
      !request ||
      request.status !== "pending" ||
      request.expiresAt.getTime() <= Date.now()
    )
      throw new DesktopError("request_expired", 410);
    if (decision === "deny") {
      await tx
        .update(desktopAuthRequests)
        .set({
          status: "denied",
          accountId: actor.accountId,
          browserSessionId: actor.sessionId,
        })
        .where(eq(desktopAuthRequests.id, id));
      return null;
    }
    if (replacement) {
      const [device] = await tx
        .select()
        .from(desktopSessions)
        .where(
          and(
            eq(desktopSessions.id, replacement),
            eq(desktopSessions.accountId, actor.accountId),
            eq(desktopSessions.mode, "transient"),
            isNull(desktopSessions.revokedAt),
            gt(desktopSessions.expiresAt, new Date()),
          ),
        );
      if (!device) throw new DesktopError("invalid_replacement", 409);
    }
    const code = token("code");
    await tx
      .update(desktopAuthRequests)
      .set({
        status: "approved",
        accountId: actor.accountId,
        browserSessionId: actor.sessionId,
        role: actor.role,
        grantId: actor.adminGrantId,
        uploaderGrantId: actor.uploaderGrantId ?? null,
        replacedSessionId: replacement ?? null,
        codeHash: secretHash("code", code),
        codeExpiresAt: new Date(
          Math.min(Date.now() + 60_000, request.expiresAt.getTime()),
        ),
      })
      .where(eq(desktopAuthRequests.id, id));
    const callback = new URL(request.redirectUri);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", request.state);
    return callback.toString();
  });
}
async function mint(
  tx: DbTransaction,
  sessionId: string,
  absolute: Date,
  generation: number,
) {
  const accessToken = token("access"),
    refreshToken = token("refresh");
  const expiresAt = new Date(
    Math.min(Date.now() + ACCESS_MS, absolute.getTime()),
  );
  await tx.insert(desktopCredentials).values([
    {
      sessionId,
      kind: "access",
      tokenHash: secretHash("access", accessToken),
      generation,
      expiresAt,
    },
    {
      sessionId,
      kind: "refresh",
      tokenHash: secretHash("refresh", refreshToken),
      generation,
      expiresAt: absolute,
    },
  ]);
  return {
    protocol: PROTOCOL,
    tokenType: "Bearer",
    accessToken,
    refreshToken,
    accessExpiresAt: expiresAt.toISOString(),
    deviceExpiresAt: absolute.toISOString(),
    deviceSessionId: sessionId,
    scope: SCOPES,
  };
}
export async function exchangeAuthorization(input: unknown, ip: string) {
  requireDesktop();
  await authBudget(ip);
  const body = object(input);
  exactKeys(body, ["clientId", "code", "redirectUri", "codeVerifier"]);
  if (
    body.clientId !== CLIENT_ID ||
    !validToken(body.code, "code") ||
    typeof body.codeVerifier !== "string" ||
    !/^[A-Za-z0-9._~-]{43,128}$/.test(body.codeVerifier)
  )
    throw new DesktopError("invalid_grant", 401);
  const codeHash = secretHash("code", body.code),
    challenge = pkce(body.codeVerifier);
  const [hint] = await db
    .select()
    .from(desktopAuthRequests)
    .where(eq(desktopAuthRequests.codeHash, codeHash));
  if (!hint?.accountId) throw new DesktopError("invalid_grant", 401);
  return db.transaction(async (tx) => {
    await accountSessionLocks(tx, hint.accountId!);
    const [request] = await tx
      .select()
      .from(desktopAuthRequests)
      .where(eq(desktopAuthRequests.id, hint.id))
      .for("update");
    if (
      !request ||
      request.status !== "approved" ||
      request.codeHash !== codeHash ||
      request.redirectUri !== body.redirectUri ||
      request.challenge !== challenge ||
      !request.codeExpiresAt ||
      request.codeExpiresAt.getTime() <= Date.now() ||
      request.expiresAt.getTime() <= Date.now()
    )
      throw new DesktopError("invalid_grant", 401);
    const [account] = await tx
      .select()
      .from(authAccounts)
      .where(eq(authAccounts.id, request.accountId!));
    const actor: Actor = {
      role: request.role as Actor["role"],
      accountId: account.id,
      discordUserId: account.discordUserId,
      name: account.displayName,
      sessionId: request.browserSessionId!,
      adminGrantId: request.grantId,
      uploaderGrantId: request.uploaderGrantId,
    };
    await lockUploadAuthority(tx, actor);
    const devices = await tx
      .select()
      .from(desktopSessions)
      .where(
        and(
          eq(desktopSessions.accountId, actor.accountId),
          isNull(desktopSessions.revokedAt),
          gt(desktopSessions.expiresAt, new Date()),
        ),
      )
      .orderBy(asc(desktopSessions.id))
      .for("update");
    if (request.replacedSessionId) {
      if (
        !devices.some(
          (d) => d.id === request.replacedSessionId && d.mode === "transient",
        )
      )
        throw new DesktopError("invalid_replacement", 409);
      await revokeDevicesInTx(tx, actor.accountId, actor, [
        request.replacedSessionId,
      ]);
    }
    if (devices.length - (request.replacedSessionId ? 1 : 0) >= 5)
      throw new DesktopError("device_limit", 409);
    const id = crypto.randomUUID(),
      expiresAt = new Date(
        Date.now() +
          (request.mode === "persistent" ? PERSISTENT_MS : TRANSIENT_MS),
      );
    await tx.insert(authSessions).values({
      id,
      kind: "desktop",
      accountId: actor.accountId,
      guildId: getAuthorityConfig().guildId,
      referenceHash: secretHash("session", id),
      expiresAt,
    });
    await tx.insert(desktopSessions).values({
      id,
      accountId: actor.accountId,
      role: actor.role,
      grantId: actor.adminGrantId,
      uploaderGrantId: actor.uploaderGrantId ?? null,
      mode: request.mode,
      scopes: SCOPES,
      expiresAt,
    });
    const credentials = await mint(tx, id, expiresAt, 0);
    await tx
      .update(desktopAuthRequests)
      .set({ status: "consumed", codeHash: null })
      .where(eq(desktopAuthRequests.id, request.id));
    await appendAudit(tx, actor, {
      action: "desktop.connected",
      targetType: "device",
      targetId: id,
      after: {
        deviceSessionId: id,
        channel: "desktop",
        mode: request.mode as "transient" | "persistent",
        ...(request.replacedSessionId
          ? { replacedSessionId: request.replacedSessionId }
          : {}),
      },
    });
    return credentials;
  });
}
export async function refreshAuthorization(input: unknown, ip: string) {
  requireDesktop();
  const body = object(input);
  exactKeys(body, ["refreshToken"]);
  if (!validToken(body.refreshToken, "refresh"))
    throw new DesktopError("invalid_token", 401);
  await authBudget(ip, undefined, true);
  const actor = await credentialActor(body.refreshToken, "refresh");
  if (
    !(await consumeRequestBudgets([
      {
        key: budgetKey("desktop:refresh:device", actor.deviceSessionId),
        limit: 10,
        windowMs: 60_000,
      },
    ]))
  )
    throw new DesktopError("rate_limited", 429, 60);
  const result = await db.transaction(async (tx) => {
    await accountSessionLocks(tx, actor.accountId);
    const { device, credential } = await lockDevice(
      tx,
      actor,
      "replay:upload",
      { allowConsumed: true },
    );
    if (credential.consumedAt) {
      await revokeDevicesInTx(tx, actor.accountId, actor, [device.id]);
      return null;
    }
    await tx
      .update(desktopCredentials)
      .set({ consumedAt: new Date() })
      .where(eq(desktopCredentials.id, credential.id));
    await tx
      .update(desktopSessions)
      .set({ lastUsedAt: new Date() })
      .where(eq(desktopSessions.id, device.id));
    return mint(tx, device.id, device.expiresAt, credential.generation + 1);
  });
  if (!result) throw new DesktopError("refresh_reused", 401);
  return result;
}
export async function revokeOwnAccess(value: string) {
  const actor = await credentialActor(
    value,
    validToken(value, "refresh") ? "refresh" : "access",
  );
  await db.transaction(async (tx) => {
    await accountSessionLocks(tx, actor.accountId);
    await lockDevice(tx, actor, "revoke", { allowDisabled: true });
    await revokeDevicesInTx(tx, actor.accountId, actor, [
      actor.deviceSessionId,
    ]);
  });
}
export async function listOwnDevices(actor: Actor) {
  return db.transaction(async (tx) => {
    await lockBrowserIdentity(tx, actor);
    const now = new Date();
    const rows = await tx
      .select({
        id: desktopSessions.id,
        name: desktopSessions.name,
        mode: desktopSessions.mode,
        createdAt: desktopSessions.createdAt,
        expiresAt: desktopSessions.expiresAt,
        revokedAt: desktopSessions.revokedAt,
      })
      .from(desktopSessions)
      .where(eq(desktopSessions.accountId, actor.accountId))
      .orderBy(
        desc(
          sql<boolean>`${desktopSessions.revokedAt} is null and ${desktopSessions.expiresAt} > ${now}`,
        ),
        desc(desktopSessions.createdAt),
        desc(desktopSessions.id),
      )
      .limit(100);
    return rows.map((row) => ({
      ...row,
      active: !row.revokedAt && row.expiresAt.getTime() > now.getTime(),
    }));
  });
}
export async function revokeOwnDevice(actor: Actor, id: string) {
  if (!isUuid(id)) throw new DesktopError("invalid_request");
  await db.transaction(async (tx) => {
    await accountSessionLocks(tx, actor.accountId);
    await lockBrowserIdentity(tx, actor);
    await revokeDevicesInTx(tx, actor.accountId, actor, [id]);
  });
}
