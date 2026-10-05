CREATE TABLE "admin_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "admin_credentials_key_hash_unique" UNIQUE("key_hash"),
	CONSTRAINT "admin_credentials_hash_format" CHECK ("admin_credentials"."key_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_role" text,
	"actor_member_id" uuid,
	"actor_credential_id" uuid,
	"actor_name" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"result" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"request_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_uploads" ADD COLUMN "actor_role" text;--> statement-breakpoint
ALTER TABLE "pending_uploads" ADD COLUMN "actor_member_id" uuid;--> statement-breakpoint
ALTER TABLE "pending_uploads" ADD COLUMN "actor_credential_id" uuid;--> statement-breakpoint
ALTER TABLE "pending_uploads" ADD COLUMN "actor_name" text;--> statement-breakpoint
ALTER TABLE "admin_credentials" ADD CONSTRAINT "admin_credentials_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_credentials_active_member_idx" ON "admin_credentials" USING btree ("member_id") WHERE "admin_credentials"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "audit_logs_occurred_at_idx" ON "audit_logs" USING btree ("occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);