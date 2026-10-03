import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Club members. The UUID is the member's stable primary identity; it must not
 * change when the name is edited or accounts are (un)linked.
 */
export const members = pgTable("members", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  birthYear: integer("birth_year"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Riot accounts. A member can own several. `memberId` is NULL while the account
 * is unlinked ("보류"); linking it later retroactively resolves all past
 * participants to that member.
 *
 * Identity: `puuid` is Riot's stable id and is the dedup key when present
 * (renames change game_name#tag_line but not the puuid). Pre-Riot-ID replays
 * may lack a puuid, so those rows fall back to (game_name, tag_line). The two
 * partial unique indexes keep each scheme independent.
 */
export const riotAccounts = pgTable(
  "riot_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    memberId: uuid("member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    gameName: text("game_name").notNull(),
    tagLine: text("tag_line").notNull(),
    puuid: text("puuid"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("riot_accounts_puuid_key")
      .on(t.puuid)
      .where(sql`${t.puuid} is not null`),
    uniqueIndex("riot_accounts_game_name_tag_line_key")
      .on(t.gameName, t.tagLine)
      .where(sql`${t.puuid} is null`),
    index("riot_accounts_member_id_idx").on(t.memberId),
  ],
);

/**
 * A single ingested game. `playedAt` is always populated: a .rofl carries no
 * date, so it comes from the uploaded file's lastModified, falling back to the
 * upload time. `playedAtSource` records which was used.
 */
export const games = pgTable(
  "games",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fileHash: text("file_hash").notNull().unique(),
    blobUrl: text("blob_url").notNull(),
    originalFilename: text("original_filename"),
    playedAt: timestamp("played_at", { withTimezone: true }).notNull(),
    playedAtSource: text("played_at_source").notNull(),
    playedAtOverride: timestamp("played_at_override", { withTimezone: true }),
    excludedAt: timestamp("excluded_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    gameVersion: text("game_version"),
    winningTeam: integer("winning_team"),
    rawMetadata: jsonb("raw_metadata"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("games_played_at_idx").on(t.playedAt),
    index("games_active_effective_date_idx")
      .on(
        sql`coalesce(${t.playedAtOverride}, ${t.playedAt}) desc`,
        t.uploadedAt.desc(),
        t.id.desc(),
      )
      .where(sql`${t.excludedAt} is null`),
    index("games_excluded_effective_date_idx")
      .on(
        sql`coalesce(${t.playedAtOverride}, ${t.playedAt}) desc`,
        t.uploadedAt.desc(),
        t.id.desc(),
      )
      .where(sql`${t.excludedAt} is not null`),
  ],
);

/**
 * Per-player stats for a game. References a riot account; the member is
 * resolved through `riotAccounts.memberId`. `position` is nullable because it
 * is unknown for non-5v5 modes and can be unreliable in off-role customs.
 */
export const gameParticipants = pgTable(
  "game_participants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    riotAccountId: uuid("riot_account_id")
      .notNull()
      .references(() => riotAccounts.id, { onDelete: "restrict" }),
    team: integer("team"),
    position: text("position"),
    champion: text("champion"),
    win: boolean("win"),
    kills: integer("kills"),
    deaths: integer("deaths"),
    assists: integer("assists"),
    goldEarned: integer("gold_earned"),
    rawStats: jsonb("raw_stats"),
  },
  (t) => [
    unique("game_participants_game_id_riot_account_id_key").on(
      t.gameId,
      t.riotAccountId,
    ),
    index("game_participants_riot_account_id_idx").on(t.riotAccountId),
  ],
);

/**
 * One row per direct-to-Blob upload authorization. `/api/uploads` issues the
 * binding (id + secret nonce, returned once and stored only as a SHA-256 hash),
 * `/api/blob/upload` mints tokens only for the bound pathname, and
 * `/api/process` fetches/deletes only the exact Blob bound here. Rows move
 * pending → processing → processed | failed and are never reusable after
 * leaving `pending`; expired/aged rows are swept opportunistically on create.
 */
export const pendingUploads = pgTable(
  "pending_uploads",
  {
    id: uuid("id").primaryKey(),
    nonceHash: text("nonce_hash").notNull(),
    pathname: text("pathname").notNull(),
    state: text("state").notNull().default("pending"),
    blobUrl: text("blob_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("pending_uploads_expires_at_idx").on(t.expiresAt)],
);

export const membersRelations = relations(members, ({ many }) => ({
  riotAccounts: many(riotAccounts),
}));

export const riotAccountsRelations = relations(
  riotAccounts,
  ({ one, many }) => ({
    member: one(members, {
      fields: [riotAccounts.memberId],
      references: [members.id],
    }),
    participants: many(gameParticipants),
  }),
);

export const gamesRelations = relations(games, ({ many }) => ({
  participants: many(gameParticipants),
}));

export const gameParticipantsRelations = relations(
  gameParticipants,
  ({ one }) => ({
    game: one(games, {
      fields: [gameParticipants.gameId],
      references: [games.id],
    }),
    riotAccount: one(riotAccounts, {
      fields: [gameParticipants.riotAccountId],
      references: [riotAccounts.id],
    }),
  }),
);

export type Member = typeof members.$inferSelect;
export type PendingUpload = typeof pendingUploads.$inferSelect;
export type RiotAccount = typeof riotAccounts.$inferSelect;
export type Game = typeof games.$inferSelect;
export type GameParticipant = typeof gameParticipants.$inferSelect;
export type NewGame = typeof games.$inferInsert;
export type NewGameParticipant = typeof gameParticipants.$inferInsert;
