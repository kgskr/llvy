CREATE TABLE "game_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"riot_account_id" uuid NOT NULL,
	"team" integer,
	"position" text,
	"champion" text,
	"win" boolean,
	"kills" integer,
	"deaths" integer,
	"assists" integer,
	"gold_earned" integer,
	"raw_stats" jsonb,
	CONSTRAINT "game_participants_game_id_riot_account_id_key" UNIQUE("game_id","riot_account_id")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_hash" text NOT NULL,
	"blob_url" text NOT NULL,
	"original_filename" text,
	"played_at" timestamp with time zone NOT NULL,
	"played_at_source" text NOT NULL,
	"duration_ms" integer,
	"game_version" text,
	"winning_team" integer,
	"raw_metadata" jsonb,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_file_hash_unique" UNIQUE("file_hash")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"birth_year" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "riot_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid,
	"game_name" text NOT NULL,
	"tag_line" text NOT NULL,
	"puuid" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"linked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "game_participants" ADD CONSTRAINT "game_participants_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_participants" ADD CONSTRAINT "game_participants_riot_account_id_riot_accounts_id_fk" FOREIGN KEY ("riot_account_id") REFERENCES "public"."riot_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riot_accounts" ADD CONSTRAINT "riot_accounts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_participants_riot_account_id_idx" ON "game_participants" USING btree ("riot_account_id");--> statement-breakpoint
CREATE INDEX "games_played_at_idx" ON "games" USING btree ("played_at");--> statement-breakpoint
CREATE UNIQUE INDEX "riot_accounts_puuid_key" ON "riot_accounts" USING btree ("puuid") WHERE "riot_accounts"."puuid" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "riot_accounts_game_name_tag_line_key" ON "riot_accounts" USING btree ("game_name","tag_line") WHERE "riot_accounts"."puuid" is null;--> statement-breakpoint
CREATE INDEX "riot_accounts_member_id_idx" ON "riot_accounts" USING btree ("member_id");