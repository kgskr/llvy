import pg from "pg";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
const { Pool } = pg;
import { readdir, readFile } from "node:fs/promises";
const url = process.env.LLVY_POSTGRES_TEST_URL;
const parsed = new URL(url);
if (
  !["postgres:", "postgresql:"].includes(parsed.protocol) ||
  parsed.hostname !== "127.0.0.1" ||
  parsed.pathname !== "/llvy_auth_test" ||
  parsed.search ||
  parsed.hash
)
  throw Error("Requires disposable localhost llvy_auth_test");
const root = fileURLToPath(new URL("../drizzle", import.meta.url));
const admin = new Pool({ connectionString: url });
const database = "llvy_migration_" + randomUUID().replaceAll("-", "");
let test,
  created = false;
try {
  await admin.query("CREATE DATABASE " + database);
  created = true;
  test = new Pool({
    connectionString: url.replace("/llvy_auth_test", "/" + database),
    max: 1,
  });
  const files = (await readdir(root))
    .filter((n) => /^000[0-9]_.*\.sql$/.test(n))
    .sort();
  for (const name of files)
    await test.query(await readFile(root + "/" + name, "utf8"));
  await test.query(
    "INSERT INTO auth_accounts (id,discord_user_id,username,display_name,guild_id,membership_checked_at) VALUES ('11111111-1111-4111-8111-111111111111','111111111111111111','fixture','fixture','222222222222222222',now())",
  );
  await test.query(
    "INSERT INTO auth_sessions (id,account_id,reference_hash,guild_id,expires_at) VALUES ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','fixture-hash','222222222222222222',now()+interval '1 day')",
  );
  await test.query(
    "INSERT INTO pending_uploads (id,nonce_hash,pathname,actor_role,expires_at) VALUES ('33333333-3333-4333-8333-333333333333','fixture-hash','replays/fixture.rofl','owner',now()+interval '1 hour')",
  );
  await test.query(
    "INSERT INTO games (file_hash,blob_url,played_at,played_at_source) VALUES ('fixture-game-hash','https://fixture.invalid/replay','2026-01-01','upload')",
  );
  await test.query(
    "INSERT INTO admin_grants (account_id,issued_by) SELECT id,id FROM auth_accounts",
  );
  await test.query(
    "INSERT INTO audit_logs (action,target_type,result,request_id,actor_role,actor_name) VALUES ('replay.processed','upload','success','44444444-4444-4444-8444-444444444444','admin','Fixture')",
  );
  const tables = [
    "auth_accounts",
    "auth_sessions",
    "admin_grants",
    "audit_logs",
    "pending_uploads",
    "games",
  ];
  const before = Object.fromEntries(
    await Promise.all(
      tables.map(async (name) => [
        name,
        (await test.query("SELECT * FROM " + name)).rows,
      ]),
    ),
  );
  const migration = await readFile(root + "/0010_uploader_role.sql", "utf8");
  await test.query("BEGIN");
  await test.query(migration);
  try {
    await test.query("SELECT 1/0");
  } catch {
    await test.query("ROLLBACK");
  }
  const rolled = await test.query(
    "SELECT to_regclass('uploader_grants') AS created, count(*)::int AS sessions FROM auth_sessions",
  );
  if (rolled.rows[0].created !== null || rolled.rows[0].sessions !== 1)
    throw Error("migration rollback failed");
  await test.query("BEGIN");
  await test.query(migration);
  await test.query("COMMIT");
  for (const name of tables) {
    const rows = (await test.query("SELECT * FROM " + name)).rows;
    for (const row of rows) {
      delete row.actor_uploader_grant_id;
      if (name === "pending_uploads") {
        if (row.audit_metadata !== null)
          throw Error("legacy audit metadata must be null");
        delete row.audit_metadata;
      }
    }
    if (JSON.stringify(rows) !== JSON.stringify(before[name]))
      throw Error("legacy rows changed: " + name);
  }
  await test.query(
    "INSERT INTO uploader_grants (account_id,issued_by) SELECT id,id FROM auth_accounts",
  );
  try {
    await test.query(
      "INSERT INTO uploader_grants (account_id,issued_by) SELECT id,id FROM auth_accounts",
    );
    throw Error("active uploader uniqueness missing");
  } catch (error) {
    if (error.code !== "23505") throw error;
  }
  // Raw migration replay is intentionally rejected; production uses Drizzle's journal.
  await test.query("BEGIN");
  try {
    await test.query(migration);
    throw Error("raw migration unexpectedly replayed");
  } catch (error) {
    if (error.code !== "42P07") throw error;
  } finally {
    await test.query("ROLLBACK");
  }
  console.log(
    "PASS: migration 0010 transactional rollback, legacy row preservation, active uploader uniqueness and raw replay rejection",
  );
} finally {
  await test?.end();
  if (created) await admin.query("DROP DATABASE " + database);
  await admin.end();
}
