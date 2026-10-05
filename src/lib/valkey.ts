import "server-only";

import { createHash } from "node:crypto";
import Redis from "ioredis";

const TIMEOUT_MS = 1_000;
const RETRY_DELAY_MS = 5_000;
let connection: {
  url: string;
  client: Redis;
  ready: Promise<Redis | null>;
} | null = null;
let retryAt = 0;
let lastWarningAt = -Infinity;

function warnUnavailable() {
  if (Date.now() - lastWarningAt < 30_000) return;
  lastWarningAt = Date.now();
  // Never log the URL, credentials or a driver's raw error.
  console.warn("Valkey cache unavailable; using PostgreSQL directly.");
}

function configuration() {
  const value = process.env.VALKEY_URL?.trim();
  if (!value) return null;
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.protocol !== "rediss:" &&
    !(
      url.protocol === "redis:" &&
      local &&
      process.env.NODE_ENV !== "production"
    )
  )
    throw new Error("Valkey requires TLS outside local development.");

  // Identify the database without retaining its password in cache keys.
  const postgres = process.env.POSTGRES_URL;
  const database = postgres ? new URL(postgres) : null;
  const identity = database
    ? `${database.host}${database.pathname}`
    : "unconfigured-postgres";
  const digest = createHash("sha256")
    .update(identity)
    .digest("hex")
    .slice(0, 16);
  const prefix = process.env.VALKEY_KEY_PREFIX?.trim() || "llvy";
  const environment =
    process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
  return {
    url: value,
    tls: url.protocol === "rediss:" ? { servername: url.hostname } : undefined,
    prefix: `${prefix}:${environment}:${digest}:v1`,
  };
}

/** Close only this app's connection; no keys or server data are deleted. */
export function disconnectValkey(): void {
  connection?.client.disconnect();
  connection = null;
  retryAt = 0;
}

export function valkeyFailed(client: Redis): void {
  if (connection?.client === client) {
    disconnectValkey();
    retryAt = Date.now() + RETRY_DELAY_MS;
  }
  warnUnavailable();
}

/** One lazy connection per warm Node.js instance, shared by concurrent reads. */
export async function getValkeyConnection() {
  let config: ReturnType<typeof configuration>;
  try {
    config = configuration();
  } catch {
    warnUnavailable();
    return null;
  }
  if (!config) return null;
  if (connection && connection.url !== config.url) disconnectValkey();
  if (Date.now() < retryAt) return null;
  if (!connection) {
    let client: Redis;
    try {
      client = new Redis(config.url, {
        tls: config.tls,
        lazyConnect: true,
        connectTimeout: TIMEOUT_MS,
        commandTimeout: TIMEOUT_MS,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
        enableOfflineQueue: false,
        autoResendUnfulfilledCommands: false,
      });
    } catch {
      warnUnavailable();
      retryAt = Date.now() + RETRY_DELAY_MS;
      return null;
    }
    client.on("error", warnUnavailable);
    let deadline: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      deadline = setTimeout(
        () => reject(new Error("Valkey readiness timeout")),
        TIMEOUT_MS,
      );
    });
    const ready = Promise.race([client.connect(), timeout])
      .then(
        () => client,
        () => {
          valkeyFailed(client);
          return null;
        },
      )
      .finally(() => clearTimeout(deadline));
    connection = { url: config.url, client, ready };
  }
  const client = await connection.ready;
  if (!client) return null;
  if (client.status !== "ready") {
    valkeyFailed(client);
    return null;
  }
  return { client, prefix: config.prefix };
}
