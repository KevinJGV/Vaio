ALTER TABLE "escalations" ADD COLUMN "notify_topic_id" text;--> statement-breakpoint
CREATE INDEX "escalations_notify_topic_idx" ON "escalations" USING btree ("notify_channel","notify_topic_id");