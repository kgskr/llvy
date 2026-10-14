CREATE TABLE "cache_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"epoch" uuid DEFAULT gen_random_uuid() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cache_revisions" (
	"scope" text PRIMARY KEY NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL
);

--> statement-breakpoint
INSERT INTO cache_policy (id) VALUES ('business');
--> statement-breakpoint
INSERT INTO cache_revisions (scope) VALUES ('members'), ('accounts'), ('game-list'), ('history'), ('riot-eligibility');
--> statement-breakpoint
INSERT INTO cache_revisions (scope) SELECT 'game:' || id::text FROM games;
