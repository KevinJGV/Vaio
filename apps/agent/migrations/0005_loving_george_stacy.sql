CREATE TABLE "tracked_repos" (
	"source" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"repo" text NOT NULL,
	"branch" text NOT NULL,
	"last_commit_sha" text,
	"last_tree_sha" text,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_status" text,
	"embedded_count" integer DEFAULT 0,
	"deleted_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "path" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "blob_sha" text;--> statement-breakpoint
CREATE INDEX "documents_source_path_idx" ON "documents" USING btree ("source","path","blob_sha");