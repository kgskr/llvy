CREATE TABLE "request_budgets" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_uploads" ADD COLUMN "cleanup_claimed_at" timestamp with time zone;