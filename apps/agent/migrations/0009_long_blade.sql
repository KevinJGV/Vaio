CREATE TABLE "escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin_channel" text NOT NULL,
	"origin_conversation_id" uuid,
	"origin_thread_key" text,
	"asker_principal_id" text NOT NULL,
	"locale" text DEFAULT 'es' NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"notify_channel" text,
	"notify_message_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"fact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"notified_at" timestamp with time zone,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "escalations_notify_msg_idx" ON "escalations" USING btree ("notify_channel","notify_message_id");--> statement-breakpoint
CREATE INDEX "escalations_status_idx" ON "escalations" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "escalations_principal_idx" ON "escalations" USING btree ("asker_principal_id","status");