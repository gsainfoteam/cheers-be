import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { notificationEvent } from "./enums";

/*
CREATE TABLE "alimtalk_template" (
    "event"       notification_event       NOT NULL PRIMARY KEY,
    "tpl_code"    varchar(64)              NOT NULL DEFAULT '',
    "title"       varchar(50)              NOT NULL,
    "message"     text                     NOT NULL,
    "button_name" varchar(14)              NOT NULL,
    "updated_at"  timestamp with time zone NOT NULL DEFAULT NOW()
);
*/
// 이벤트별 알림톡 템플릿 (CRB-78). 어드민에서 수정함.
// 알리고에 등록한 템플릿과 글자 하나까지 같아야 전송되므로 값을 바꾸면 알리고 · 카카오에서도 같이 바꿔야 함.
// 행은 마이그레이션이 이벤트마다 하나씩 만들어 둠. tpl_code가 비어 있으면 그 이벤트의 알림톡은 보내지 않음
export const alimtalkTemplate = pgTable("alimtalk_template", {
  event: notificationEvent("event").primaryKey().notNull(),
  // 알리고 템플릿 코드 (tpl_code)
  tplCode: varchar("tpl_code", { length: 64 }).notNull().default(""),
  // 강조표기형 타이틀 (emtitle_1). 관리용 제목(subject_1)에도 같은 값을 씀
  title: varchar("title", { length: 50 }).notNull(),
  message: text("message").notNull(),
  buttonName: varchar("button_name", { length: 14 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
