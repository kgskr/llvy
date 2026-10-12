import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, it } from "vitest";

it("upgrades password-era data without linking Discord accounts or losing history", async () => {
  const migrationsFolder = fileURLToPath(
    new URL("../../drizzle", import.meta.url),
  );
  const olderFolder = await mkdtemp(join(tmpdir(), "llvy-discord-upgrade-"));
  const client = new PGlite();
  try {
    const db = drizzle(client);
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    const previous = journal.entries.filter((entry) => entry.idx < 6);
    await mkdir(join(olderFolder, "meta"));
    await writeFile(
      join(olderFolder, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: previous }),
    );
    await Promise.all(
      previous.map((entry) =>
        copyFile(
          join(migrationsFolder, entry.tag + ".sql"),
          join(olderFolder, entry.tag + ".sql"),
        ),
      ),
    );
    await migrate(db, { migrationsFolder: olderFolder });
    const memberId = "11111111-1111-4111-8111-111111111111";
    const credentialId = "22222222-2222-4222-8222-222222222222";
    await client.query(
      "INSERT INTO members(id,name,birth_year) VALUES ($1,'김모임원',1990)",
      [memberId],
    );
    await client.query(
      "INSERT INTO admin_credentials(id,member_id,key_hash) VALUES ($1,$2,$3)",
      [credentialId, memberId, "a".repeat(64)],
    );
    await client.query(
      "INSERT INTO riot_accounts(puuid,game_name,tag_line,member_id) VALUES ('preserved-puuid','Player','KR1',$1)",
      [memberId],
    );
    await client.query(
      "INSERT INTO audit_logs(actor_role,actor_member_id,actor_credential_id,actor_name,action,target_type,result,request_id) VALUES ('admin',$1,$2,'이전 이름','member.updated','member','success','33333333-3333-4333-8333-333333333333')",
      [memberId, credentialId],
    );
    await client.query(
      "INSERT INTO games(file_hash,blob_url,played_at,played_at_source,duration_ms) VALUES ('preserved-file','https://example.invalid/original.rofl','2026-10-01','file_mtime',1000)",
    );
    const before = await client.query<Record<string, unknown>>(
      "SELECT * FROM audit_logs",
    );
    await migrate(db, { migrationsFolder });
    await migrate(db, { migrationsFolder });
    expect((await client.query("SELECT * FROM auth_accounts")).rows).toEqual(
      [],
    );
    expect(
      (
        await client.query(
          "SELECT revoked_at IS NOT NULL AS retired FROM admin_credentials",
        )
      ).rows,
    ).toEqual([{ retired: true }]);
    const audit = (await client.query("SELECT * FROM audit_logs")).rows[0];
    expect(audit).toMatchObject(before.rows[0]);
    expect(audit).toMatchObject({
      actor_account_id: null,
      actor_discord_user_id: null,
      actor_admin_grant_id: null,
    });
    expect(
      (await client.query("SELECT puuid,member_id FROM riot_accounts")).rows,
    ).toEqual([{ puuid: "preserved-puuid", member_id: memberId }]);
    expect((await client.query("SELECT file_hash FROM games")).rows).toEqual([
      { file_hash: "preserved-file" },
    ]);
    await client.query("DELETE FROM members WHERE id=$1", [memberId]);
    expect(
      (await client.query("SELECT id,member_id FROM admin_credentials")).rows,
    ).toEqual([{ id: credentialId, member_id: null }]);
    expect(
      (
        await client.query(
          "SELECT actor_member_id,actor_credential_id,actor_name FROM audit_logs",
        )
      ).rows,
    ).toEqual([
      {
        actor_member_id: memberId,
        actor_credential_id: credentialId,
        actor_name: "이전 이름",
      },
    ]);
  } finally {
    await client.close();
    await rm(olderFolder, { recursive: true, force: true });
  }
}, 30_000);
