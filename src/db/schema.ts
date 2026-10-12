import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  pgSequence,
  primaryKey,
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
export const members = pgTable(
  "members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name")
      .generatedAlwaysAs(sql`llvy_normalize_search_v1(name)`)
      .notNull(),
    birthYear: integer("birth_year"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("members_normalized_name_idx").using("hash", t.normalizedName)],
);

/** Each grant has a new identity; revocation never revives old sessions. */
export const adminCredentials = pgTable(
  "admin_credentials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    memberId: uuid("member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    keyHash: text("key_hash").notNull().unique(),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("admin_credentials_active_member_idx")
      .on(t.memberId)
      .where(sql`${t.revokedAt} is null`),
    check(
      "admin_credentials_hash_format",
      sql`${t.keyHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

/** Append-only through the application; no secrets or raw requests. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    actorRole: text("actor_role"),
    actorMemberId: uuid("actor_member_id"),
    actorCredentialId: uuid("actor_credential_id"),
    actorAccountId: uuid("actor_account_id"),
    actorDiscordUserId: text("actor_discord_user_id"),
    actorAdminGrantId: uuid("actor_admin_grant_id"),
    actorName: text("actor_name"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    result: text("result").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    requestId: uuid("request_id").notNull(),
  },
  (t) => [
    index("audit_logs_occurred_at_idx").on(t.occurredAt.desc(), t.id.desc()),
  ],
);

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
    normalizedGameName: text("normalized_game_name")
      .generatedAlwaysAs(sql`llvy_normalize_search_v1(game_name)`)
      .notNull(),
    normalizedTagLine: text("normalized_tag_line")
      .generatedAlwaysAs(sql`llvy_normalize_search_v1(tag_line)`)
      .notNull(),
    nameObservedAt: timestamp("name_observed_at", { withTimezone: true }),
    puuid: text("puuid"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
  },
  (t) => [
    index("riot_accounts_normalized_name_idx").using(
      "hash",
      t.normalizedGameName,
    ),
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
 * upload date. Only the Korea calendar date is stored.
 */
export const games = pgTable(
  "games",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fileHash: text("file_hash").notNull().unique(),
    blobUrl: text("blob_url").notNull(),
    originalFilename: text("original_filename"),
    playedAt: date("played_at", { mode: "string" }).notNull(),
    playedAtSource: text("played_at_source").notNull(),
    playedAtOverride: date("played_at_override", { mode: "string" }),
    comment: text("comment"),
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
    check("games_comment_length", sql`char_length(${t.comment}) <= 30`),
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
 * leaving `pending`; expired rows are reconciled before removal.
 */
export const pendingUploads = pgTable(
  "pending_uploads",
  {
    id: uuid("id").primaryKey(),
    nonceHash: text("nonce_hash").notNull(),
    actorRole: text("actor_role"),
    actorMemberId: uuid("actor_member_id"),
    actorCredentialId: uuid("actor_credential_id"),
    actorAccountId: uuid("actor_account_id"),
    actorDiscordUserId: text("actor_discord_user_id"),
    actorAdminGrantId: uuid("actor_admin_grant_id"),
    actorName: text("actor_name"),
    pathname: text("pathname").notNull(),
    state: text("state").notNull().default("pending"),
    blobUrl: text("blob_url"),
    cleanupClaimedAt: timestamp("cleanup_claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("pending_uploads_expires_at_idx").on(t.expiresAt)],
);

/** Atomic fixed-window budgets shared by all serverless instances. */
export const requestBudgets = pgTable("request_budgets", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});

/** Authentication identities deliberately have no game-member relationship. */
export const authMembershipVersion = pgSequence("auth_membership_version_seq");
export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    discordUserId: text("discord_user_id").notNull().unique(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    registeredAt: timestamp("registered_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    status: text("status").default("active").notNull(),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspensionReason: text("suspension_reason"),
    guildId: text("guild_id").notNull(),
    membershipStatus: text("membership_status").default("member").notNull(),
    membershipCheckedAt: timestamp("membership_checked_at", {
      withTimezone: true,
    }).notNull(),
    membershipVersion: bigint("membership_version", { mode: "number" })
      .default(0)
      .notNull(),
  },
  (t) => [
    check(
      "auth_accounts_discord_id",
      sql`${t.discordUserId} ~ '^[1-9][0-9]{0,19}$'`,
    ),
    check("auth_accounts_status", sql`${t.status} in ('active', 'suspended')`),
    check(
      "auth_accounts_profile_length",
      sql`char_length(${t.username}) between 1 and 128 and char_length(${t.displayName}) between 1 and 128`,
    ),
    index("auth_accounts_reconcile_idx").on(t.guildId, t.status, t.id),
  ],
);
/** No account/profile is created for a first-login rejection. Never expire
 * this watermark while older provider results could still be delivered. */
export const authMembershipDecisions = pgTable(
  "auth_membership_decisions",
  {
    guildId: text("guild_id").notNull(),
    discordUserId: text("discord_user_id").notNull(),
    version: bigint("version", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.discordUserId] })],
);

export const adminGrants = pgTable(
  "admin_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => authAccounts.id, { onDelete: "restrict" }),
    issuedBy: uuid("issued_by")
      .notNull()
      .references(() => authAccounts.id),
    revokedBy: uuid("revoked_by").references(() => authAccounts.id),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("admin_grants_active_account_idx")
      .on(t.accountId)
      .where(sql`${t.revokedAt} is null`),
  ],
);
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    referenceHash: text("reference_hash").notNull().unique(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => authAccounts.id),
    guildId: text("guild_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("auth_sessions_account_idx").on(t.accountId),
    index("auth_sessions_expiry_idx").on(t.expiresAt),
  ],
);
export const oauthLoginAttempts = pgTable(
  "oauth_login_attempts",
  {
    stateHash: text("state_hash").primaryKey(),
    bindingHash: text("binding_hash").notNull(),
    redirectTo: text("redirect_to").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (t) => [index("oauth_login_attempts_expiry_idx").on(t.expiresAt)],
);
export const discordApiControls = pgTable("discord_api_controls", {
  key: text("key").primaryKey(),
  reason: text("reason"),
  blockedUntil: timestamp("blocked_until", { withTimezone: true }),
  probeOwner: uuid("probe_owner"),
  probeUntil: timestamp("probe_until", { withTimezone: true }),
  version: integer("version").default(0).notNull(),
});
export const authReconciliationRuns = pgTable("auth_reconciliation_runs", {
  key: text("key").primaryKey(),
  cursor: uuid("cursor"),
  cycleStartedAt: timestamp("cycle_started_at", { withTimezone: true }),
  lastCompletedAt: timestamp("last_completed_at", { withTimezone: true }),
  leaseOwner: uuid("lease_owner"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  status: text("status").default("idle").notNull(),
  examined: integer("examined").default(0).notNull(),
  suspended: integer("suspended").default(0).notNull(),
  failed: integer("failed").default(0).notNull(),
});

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
