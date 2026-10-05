import { randomUUID } from "node:crypto";
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
import { describe, expect, it } from "vitest";

describe("date-only migration from owner-managed access schema", () => {
  it("preserves Korea calendar dates across midnight, overrides and nulls regardless of DB timezone", async () => {
    const migrationsFolder = fileURLToPath(
      new URL("../../drizzle", import.meta.url),
    );
    const olderFolder = await mkdtemp(join(tmpdir(), "llvy-calendar-upgrade-"));
    const client = new PGlite();
    const db = drizzle(client);
    try {
      const journal = JSON.parse(
        await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
      ) as {
        entries: { idx: number; tag: string }[];
      };
      const previous = journal.entries.filter((entry) => entry.idx < 5);
      await mkdir(join(olderFolder, "meta"));
      await writeFile(
        join(olderFolder, "meta/_journal.json"),
        JSON.stringify({ ...journal, entries: previous }),
      );
      await Promise.all(
        previous.map((entry) =>
          copyFile(
            join(migrationsFolder, `${entry.tag}.sql`),
            join(olderFolder, `${entry.tag}.sql`),
          ),
        ),
      );
      await migrate(db, { migrationsFolder: olderFolder });
      await client.exec("SET TIME ZONE 'America/Los_Angeles'");
      const first = randomUUID();
      const second = randomUUID();
      await client.query(
        "INSERT INTO games (id,file_hash,blob_url,played_at,played_at_source,played_at_override,duration_ms) VALUES ($1,'first','https://example.invalid/first.rofl','2026-10-04T15:00:00Z','file_mtime','2026-12-31T15:20:00Z',123456), ($2,'second','https://example.invalid/second.rofl','2026-10-04T14:59:59Z','upload',NULL,123456)",
        [first, second],
      );
      const before = await client.query<{ id: string; uploaded: string }>(
        "SELECT id, uploaded_at::text AS uploaded FROM games ORDER BY id",
      );
      await migrate(db, { migrationsFolder });
      await migrate(db, { migrationsFolder });
      const after = await client.query<{
        id: string;
        date: string;
        override: string | null;
        comment: string | null;
        duration: number;
      }>(
        "SELECT id, played_at::text AS date, played_at_override::text AS override, comment, duration_ms AS duration FROM games ORDER BY file_hash",
      );
      expect(after.rows).toEqual([
        {
          id: first,
          date: "2026-10-05",
          override: "2027-01-01",
          comment: null,
          duration: 123456,
        },
        {
          id: second,
          date: "2026-10-04",
          override: null,
          comment: null,
          duration: 123456,
        },
      ]);
      expect(
        (
          await client.query(
            "SELECT id, uploaded_at::text AS uploaded FROM games ORDER BY id",
          )
        ).rows,
      ).toEqual(before.rows);
      const types = await client.query<{
        column_name: string;
        data_type: string;
      }>(
        "SELECT column_name,data_type FROM information_schema.columns WHERE table_name='games' AND column_name IN ('played_at','played_at_override','uploaded_at') ORDER BY column_name",
      );
      expect(types.rows).toEqual([
        { column_name: "played_at", data_type: "date" },
        { column_name: "played_at_override", data_type: "date" },
        { column_name: "uploaded_at", data_type: "timestamp with time zone" },
      ]);
      await client.query("UPDATE games SET comment=$1 WHERE id=$2", [
        "😀".repeat(30),
        first,
      ]);
      await expect(
        client.query("UPDATE games SET comment=$1 WHERE id=$2", [
          "😀".repeat(31),
          first,
        ]),
      ).rejects.toThrow(/games_comment_length/);
      expect(
        (await client.query("SELECT comment FROM games WHERE id=$1", [first]))
          .rows,
      ).toEqual([{ comment: "😀".repeat(30) }]);
      expect(
        (
          await client.query(
            "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
          )
        ).rows,
      ).toEqual([{ count: 6 }]);
    } finally {
      await client.close();
      await rm(olderFolder, { recursive: true, force: true });
    }
  }, 30_000);
});
