import { relations, sql } from "drizzle-orm";
import {
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  notificationChannel,
  notificationEvent,
  notificationStatus,
} from "./enums";
import { coffeeChatRequest } from "./coffee-chat-request";

/*
CREATE TABLE "notification_log" (
    "pk"                     uuid                     NOT NULL,
    "coffee_chat_request_pk" uuid                     NOT NULL REFERENCES "coffee_chat_request" ("pk"),
    "event"                  notification_event       NOT NULL,
    "channel"                notification_channel     NOT NULL,
    "status"                 notification_status      NOT NULL,
    "created_at"             timestamp with time zone NOT NULL DEFAULT NOW(),
    "provider_message_id"    varchar(128)             NULL,
    "recipient"              varchar(255)             NOT NULL,
    "error"                  text                     NULL,
    "attempt"                smallint                 NOT NULL DEFAULT 1,
    "next_retry_at"          timestamp with time zone NULL
);
*/
// 이메일 · 카카오 알림톡 전송 로그 (channel 로 구분). 시도마다 새 행.
// 실패한 행에 next_retry_at이 있으면 재시도 스케줄러가 처리하고 비움 (CRB-75)
export const notificationLog = pgTable(
  "notification_log",
  {
    pk: uuid("pk").primaryKey().notNull(),
    coffeeChatRequestPk: uuid("coffee_chat_request_pk")
      .notNull()
      .references(() => coffeeChatRequest.pk),
    event: notificationEvent("event").notNull(),
    channel: notificationChannel("channel").notNull(),
    status: notificationStatus("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    providerMessageId: varchar("provider_message_id", { length: 128 }),
    // 이메일 주소 또는 전화번호
    recipient: varchar("recipient", { length: 255 }).notNull(),
    error: text("error"),
    // 몇 번째 발송 시도인지 (1 = 처음 발송)
    attempt: smallint("attempt").notNull().default(1),
    // 이 실패를 다시 보낼 시각. null이면 재시도 대상이 아님 (성공 · 마지막 시도 · 이미 재시도함)
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  },
  (table) => [
    index().on(table.coffeeChatRequestPk),
    // 알림 재시도 스케줄러용 (재시도 대기 중인 행만 들어감)
    index("notification_log_next_retry_at_idx")
      .on(table.nextRetryAt)
      .where(sql`${table.nextRetryAt} IS NOT NULL`),
  ],
);

export const notificationLogRelations = relations(
  notificationLog,
  ({ one }) => ({
    coffeeChatRequest: one(coffeeChatRequest, {
      fields: [notificationLog.coffeeChatRequestPk],
      references: [coffeeChatRequest.pk],
    }),
  }),
);
