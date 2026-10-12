import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as schema from "@/db/schema";
import { prepareOwnerFixture } from "@/test/auth";

// Tests get their own disposable PostgreSQL instance. No environment variables,
// network, production data, or separately installed database server are used.
export const client = new PGlite();
export const db = drizzle(client, { schema });

export async function migrateTestDatabase(): Promise<void> {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
}

export async function resetTestDatabase(prepareOwner = true): Promise<void> {
  await client.exec(
    "TRUNCATE auth_membership_decisions, audit_logs, admin_credentials, admin_grants, auth_accounts, auth_sessions, oauth_login_attempts, discord_api_controls, auth_reconciliation_runs, game_participants, games, riot_accounts, members, pending_uploads, request_budgets CASCADE",
  );
  if (prepareOwner) await prepareOwnerFixture();
}
