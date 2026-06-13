CREATE TABLE "trace_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"conversation_id" uuid,
	"turn_id" text NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "trace_events_conv_idx" ON "trace_events" USING btree ("conversation_id","id");--> statement-breakpoint
CREATE INDEX "trace_events_turn_idx" ON "trace_events" USING btree ("turn_id","seq");