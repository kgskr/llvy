CREATE TABLE "uploader_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"issued_by" uuid NOT NULL,
	"revoked_by" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "desktop_sessions" DROP CONSTRAINT "desktop_sessions_role";--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "actor_uploader_grant_id" uuid;--> statement-breakpoint
ALTER TABLE "desktop_auth_requests" ADD COLUMN "uploader_grant_id" uuid;--> statement-breakpoint
ALTER TABLE "desktop_sessions" ADD COLUMN "uploader_grant_id" uuid;--> statement-breakpoint
ALTER TABLE "pending_uploads" ADD COLUMN "actor_uploader_grant_id" uuid;--> statement-breakpoint
ALTER TABLE "pending_uploads" ADD COLUMN "audit_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "uploader_grants" ADD CONSTRAINT "uploader_grants_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploader_grants" ADD CONSTRAINT "uploader_grants_issued_by_auth_accounts_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."auth_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploader_grants" ADD CONSTRAINT "uploader_grants_revoked_by_auth_accounts_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."auth_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uploader_grants_active_account_idx" ON "uploader_grants" USING btree ("account_id") WHERE "uploader_grants"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE "desktop_sessions" ADD CONSTRAINT "desktop_sessions_role" CHECK ("desktop_sessions"."role" in ('uploader','admin','owner'));