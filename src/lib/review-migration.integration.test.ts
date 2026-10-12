import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("reproduces migration normalization functions from the frozen Unicode snapshot", async () => {
  const { searchNormalizationSql } = await import(
    new URL("../../scripts/search-normalization.mjs", import.meta.url).href
  );
  const migration = await readFile(
    new URL(
      "../../drizzle/0007_review_fixes_indexed_search.sql",
      import.meta.url,
    ),
    "utf8",
  );
  expect(migration.startsWith(searchNormalizationSql())).toBe(true);
});

it("backfills search keys, evidence versions and display observation dates on existing data", async () => {
  const client = new PGlite();
  const directory = fileURLToPath(new URL("../../drizzle/", import.meta.url));
  const journal = JSON.parse(
    await readFile(directory + "meta/_journal.json", "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  try {
    for (const entry of journal.entries.filter((entry) => entry.idx < 7))
      await client.exec(await readFile(directory + entry.tag + ".sql", "utf8"));
    await client.exec(`
      INSERT INTO members(id,name) VALUES ('10000000-0000-4000-8000-000000000001','ΟΣ');
      INSERT INTO riot_accounts(id,member_id,game_name,tag_line,puuid) VALUES ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','İstanbul','KR1','migration-puuid');
      INSERT INTO games(id,file_hash,blob_url,played_at,played_at_source) VALUES ('30000000-0000-4000-8000-000000000001','migration','https://fixture.invalid/replay','2026-10-10','file_mtime');
      INSERT INTO game_participants(game_id,riot_account_id) VALUES ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
      INSERT INTO auth_accounts(discord_user_id,username,display_name,guild_id,membership_checked_at,membership_version) VALUES ('111','user','user','222',now(),123);
      SET TIME ZONE 'America/Los_Angeles';
    `);
    await client.exec(
      await readFile(
        directory + "0007_review_fixes_indexed_search.sql",
        "utf8",
      ),
    );
    expect(
      (await client.query("select normalized_name from members")).rows,
    ).toEqual([{ normalized_name: "ος" }]);
    expect(
      (
        await client.query(
          "select normalized_game_name, normalized_tag_line, extract(epoch from name_observed_at)::bigint::text as observed from riot_accounts",
        )
      ).rows,
    ).toEqual([
      {
        normalized_game_name: "i\u0307stanbul",
        normalized_tag_line: "kr1",
        observed: String(Date.parse("2026-10-09T15:00:00Z") / 1000),
      },
    ]);
    expect(
      (
        await client.query(
          "select version::text from auth_membership_decisions",
        )
      ).rows,
    ).toEqual([{ version: "123" }]);
    await client.query("update members set name=$1", [" Cafe\u0301 "]);
    await client.query("update riot_accounts set game_name=$1,tag_line=$2", [
      "😀NEW",
      "İ",
    ]);
    expect(
      (await client.query("select normalized_name from members")).rows,
    ).toEqual([{ normalized_name: "café" }]);
    expect(
      (
        await client.query(
          "select normalized_game_name, normalized_tag_line from riot_accounts",
        )
      ).rows,
    ).toEqual([
      { normalized_game_name: "😀new", normalized_tag_line: "i\u0307" },
    ]);
  } finally {
    await client.close();
  }
}, 30_000);
