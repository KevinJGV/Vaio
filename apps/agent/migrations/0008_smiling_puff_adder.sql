CREATE TABLE "connector_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"payload" jsonb
);
--> statement-breakpoint
CREATE INDEX "connector_snapshots_source_time_idx" ON "connector_snapshots" USING btree ("source","captured_at");