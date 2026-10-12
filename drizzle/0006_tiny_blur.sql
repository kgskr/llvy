CREATE SEQUENCE "public"."auth_membership_version_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "admin_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"issued_by" uuid NOT NULL,
	"revoked_by" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_user_id" text NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"suspended_at" timestamp with time zone,
	"suspension_reason" text,
	"guild_id" text NOT NULL,
	"membership_status" text DEFAULT 'member' NOT NULL,
	"membership_checked_at" timestamp with time zone NOT NULL,
	"membership_version" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "auth_accounts_discord_user_id_unique" UNIQUE("discord_user_id"),
	CONSTRAINT "auth_accounts_discord_id" CHECK ("auth_accounts"."discord_user_id" ~ '^[1-9][0-9]{0,19}$'),
	CONSTRAINT "auth_accounts_status" CHECK ("auth_accounts"."status" in ('active', 'suspended')),
	CONSTRAINT "auth_accounts_profile_length" CHECK (char_length("auth_accounts"."username") between 1 and 128 and char_length("auth_accounts"."display_name") between 1 and 128)
);
--> statement-breakpoint
CREATE TABLE "auth_reconciliation_runs" (
	"key" text PRIMARY KEY NOT NULL,
	"cursor" uuid,
	"cycle_started_at" timestamp with time zone,
	"last_completed_at" timestamp with time zone,
	"lease_owner" uuid,
	"lease_until" timestamp with time zone,
	"status" text DEFAULT 'idle' NOT NULL,
	"examined" integer DEFAULT 0 NOT NULL,
	"suspended" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference_hash" text NOT NULL,
	"account_id" uuid NOT NULL,
	"guild_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "auth_sessions_reference_hash_unique" UNIQUE("reference_hash")
);
--> statement-breakpoint
CREATE TABLE "discord_api_controls" (
	"key" text PRIMARY KEY NOT NULL,
	"reason" text,
	"blocked_until" timestamp with time zone,
	"probe_owner" uuid,
	"probe_until" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_login_attempts" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"binding_hash" text NOT NULL,
	"redirect_to" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "admin_credentials" DROP CONSTRAINT "admin_credentials_member_id_members_id_fk";
--> statement-breakpoint
ALTER TABLE "admin_credentials" ALTER COLUMN "member_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "actor_account_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "actor_discord_user_id" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "actor_admin_grant_id" uuid;--> statement-breakpoint
ALTER TABLE "pending_uploads" ADD COLUMN "actor_account_id" uuid;--> statement-breakpoint
ALTER TABLE "pending_uploads" ADD COLUMN "actor_discord_user_id" text;--> statement-breakpoint
ALTER TABLE "pending_uploads" ADD COLUMN "actor_admin_grant_id" uuid;--> statement-breakpoint
ALTER TABLE "admin_grants" ADD CONSTRAINT "admin_grants_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_grants" ADD CONSTRAINT "admin_grants_issued_by_auth_accounts_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."auth_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_grants" ADD CONSTRAINT "admin_grants_revoked_by_auth_accounts_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."auth_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_grants_active_account_idx" ON "admin_grants" USING btree ("account_id") WHERE "admin_grants"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "auth_accounts_reconcile_idx" ON "auth_accounts" USING btree ("guild_id","status","id");--> statement-breakpoint
CREATE INDEX "auth_sessions_account_idx" ON "auth_sessions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_expiry_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "oauth_login_attempts_expiry_idx" ON "oauth_login_attempts" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "admin_credentials" ADD CONSTRAINT "admin_credentials_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
UPDATE "admin_credentials" SET "revoked_at" = now() WHERE "revoked_at" IS NULL;
