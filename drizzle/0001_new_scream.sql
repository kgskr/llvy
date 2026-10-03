CREATE TABLE "pending_uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nonce_hash" text NOT NULL,
	"pathname" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"blob_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pending_uploads_expires_at_idx" ON "pending_uploads" USING btree ("expires_at");