ALTER TABLE "notification_log" ADD COLUMN "attempt" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "next_retry_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "notification_log_next_retry_at_idx" ON "notification_log" USING btree ("next_retry_at") WHERE "notification_log"."next_retry_at" IS NOT NULL;