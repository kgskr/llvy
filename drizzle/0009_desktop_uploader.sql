CREATE TABLE "desktop_auth_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"challenge" text NOT NULL,
	"state" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"account_id" uuid,
	"browser_session_id" uuid,
	"role" text,
	"grant_id" uuid,
	"replaced_session_id" uuid,
	"code_hash" text,
	"code_expires_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "desktop_auth_requests_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "desktop_auth_requests_mode" CHECK ("desktop_auth_requests"."mode" in ('transient','persistent'))
);
--> statement-breakpoint
CREATE TABLE "desktop_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"generation" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "desktop_credentials_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "desktop_credentials_kind" CHECK ("desktop_credentials"."kind" in ('access','refresh'))
);
--> statement-breakpoint
CREATE TABLE "desktop_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"role" text NOT NULL,
	"grant_id" uuid,
	"mode" text NOT NULL,
	"scopes" text NOT NULL,
	"name" text DEFAULT 'LLVY Windows 업로더' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "desktop_sessions_mode" CHECK ("desktop_sessions"."mode" in ('transient','persistent')),
	CONSTRAINT "desktop_sessions_role" CHECK ("desktop_sessions"."role" in ('admin','owner'))
);
--> statement-breakpoint
CREATE TABLE "desktop_upload_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_session_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"nonce_hash" text NOT NULL,
	"filename" text,
	"size" integer,
	"last_modified" bigint,
	"client_sha256" text,
	"server_sha256" text,
	"store_origin" text NOT NULL,
	"pathname" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"claim_id" uuid,
	"claim_expires_at" timestamp with time zone,
	"result" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reservation_expires_at" timestamp with time zone NOT NULL,
	"result_expires_at" timestamp with time zone NOT NULL,
	"tombstone_expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "desktop_upload_jobs_device_key" UNIQUE("device_session_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "kind" text DEFAULT 'browser' NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_uploads" ADD COLUMN "channel" text DEFAULT 'browser' NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_uploads" ADD COLUMN "device_session_id" uuid;--> statement-breakpoint
ALTER TABLE "desktop_credentials" ADD CONSTRAINT "desktop_credentials_session_id_desktop_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."desktop_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desktop_sessions" ADD CONSTRAINT "desktop_sessions_id_auth_sessions_id_fk" FOREIGN KEY ("id") REFERENCES "public"."auth_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desktop_sessions" ADD CONSTRAINT "desktop_sessions_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desktop_upload_jobs" ADD CONSTRAINT "desktop_upload_jobs_device_session_id_desktop_sessions_id_fk" FOREIGN KEY ("device_session_id") REFERENCES "public"."desktop_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "desktop_auth_requests_expiry_idx" ON "desktop_auth_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "desktop_credentials_session_idx" ON "desktop_credentials" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "desktop_sessions_account_idx" ON "desktop_sessions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "desktop_upload_jobs_retention_idx" ON "desktop_upload_jobs" USING btree ("result_expires_at");