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
    .filter((n) => /^000[0-8]_.*\.sql$/.test(n))
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
  const migration = await readFile(root + "/0009_desktop_uploader.sql", "utf8");
  await test.query("BEGIN");
  await test.query(migration);
  try {
    await test.query("SELECT 1/0");
  } catch {
    await test.query("ROLLBACK");
  }
  const rolled = await test.query(
    "SELECT to_regclass('desktop_sessions') AS created, count(*)::int AS sessions FROM auth_sessions",
  );
  if (rolled.rows[0].created !== null || rolled.rows[0].sessions !== 1)
    throw Error("migration rollback failed");
  await test.query("BEGIN");
  await test.query(migration);
  await test.query("COMMIT");
  const kept = await test.query("SELECT kind FROM auth_sessions");
  const pending = await test.query("SELECT channel FROM pending_uploads");
  if (kept.rows[0].kind !== "browser" || pending.rows[0].channel !== "browser")
    throw Error("legacy defaults changed");
  const games = await test.query("SELECT count(*)::int AS n FROM games");
  if (games.rows[0].n !== 1) throw Error("game lost");
  console.log(
    "PASS: migration 0009 transactional rollback, legacy browser session and reservation preservation",
  );
} finally {
  await test?.end();
  if (created) await admin.query("DROP DATABASE " + database);
  await admin.end();
}
