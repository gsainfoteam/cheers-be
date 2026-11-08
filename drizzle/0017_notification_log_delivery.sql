CREATE TYPE "public"."notification_delivery_status" AS ENUM('pending', 'delivered', 'failed', 'unknown');--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "delivery_status" "notification_delivery_status";--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "delivery_code" varchar(32);--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "delivery_message" text;--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "delivery_reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "delivery_next_check_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "notification_log_delivery_next_check_at_idx" ON "notification_log" USING btree ("delivery_next_check_at") WHERE "notification_log"."delivery_next_check_at" IS NOT NULL;--> statement-breakpoint
-- 이미 접수된 알림톡도 다음 동기화 실행에서 최종 결과를 가져옴 (24시간이 지난 건도 한 번은 조회한 뒤 unknown으로 확정)
UPDATE "notification_log" SET "delivery_status" = 'pending', "delivery_next_check_at" = NOW() WHERE "channel" = 'kakao_alimtalk' AND "status" = 'sent' AND "provider_message_id" IS NOT NULL;
