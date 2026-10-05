import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as schema from "@/db/schema";

// Tests get their own disposable PostgreSQL instance. No environment variables,
// network, production data, or separately installed database server are used.
export const client = new PGlite();
export const db = drizzle(client, { schema });

export async function migrateTestDatabase(): Promise<void> {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
}

export async function resetTestDatabase(): Promise<void> {
  await client.exec(
    "TRUNCATE audit_logs, admin_credentials, game_participants, games, riot_accounts, members, pending_uploads, request_budgets CASCADE",
  );
}
