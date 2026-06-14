CREATE TABLE "facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"embedding" vector(1536),
	"principal_id" text NOT NULL,
	"channel" text NOT NULL,
	"conversation_id" uuid,
	"turn_id" text,
	"valid_at" timestamp with time zone,
	"invalid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"expired_at" timestamp with time zone,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "facts_embedding_idx" ON "facts" USING hnsw ("embedding" vector_cosine_ops) WHERE "facts"."status" = 'confirmed' and "facts"."invalid_at" is null;--> statement-breakpoint
CREATE INDEX "facts_pending_idx" ON "facts" USING btree ("principal_id","status");