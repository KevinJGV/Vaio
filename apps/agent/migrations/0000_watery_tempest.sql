CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "documents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"url" text,
	"chunk" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "documents_embedding_idx" ON "documents" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "documents_source_idx" ON "documents" USING btree ("source");