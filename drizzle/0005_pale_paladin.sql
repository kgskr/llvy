DROP INDEX "games_active_effective_date_idx";--> statement-breakpoint
DROP INDEX "games_excluded_effective_date_idx";--> statement-breakpoint
ALTER TABLE "games" ALTER COLUMN "played_at" SET DATA TYPE date USING ("played_at" AT TIME ZONE 'Asia/Seoul')::date;--> statement-breakpoint
ALTER TABLE "games" ALTER COLUMN "played_at_override" SET DATA TYPE date USING ("played_at_override" AT TIME ZONE 'Asia/Seoul')::date;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "comment" text;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_comment_length" CHECK (char_length("games"."comment") <= 30);
--> statement-breakpoint
CREATE INDEX "games_active_effective_date_idx" ON "games" USING btree (coalesce("played_at_override", "played_at") desc,"uploaded_at" desc,"id" desc) WHERE "games"."excluded_at" is null;--> statement-breakpoint
CREATE INDEX "games_excluded_effective_date_idx" ON "games" USING btree (coalesce("played_at_override", "played_at") desc,"uploaded_at" desc,"id" desc) WHERE "games"."excluded_at" is not null;
