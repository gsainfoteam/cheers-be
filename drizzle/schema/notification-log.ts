import { relations } from "drizzle-orm";
import {
  index,
  pgTable,
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
    "error"                  text                     NULL
);
*/
// 이메일 · 카카오 알림톡 전송 로그 (channel 로 구분). insert만 함, 재시도도 새 행
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
  },
  (table) => [index().on(table.coffeeChatRequestPk)],
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
