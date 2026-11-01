import { pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { adminAccessTargetType } from "./enums";

/*
CREATE TABLE "admin_access_log" (
    "pk"          uuid                     NOT NULL,
    "admin_email" varchar(64)              NOT NULL,
    "target_type" admin_access_target_type NOT NULL,
    "target_id"   varchar(64)              NOT NULL,
    "created_at"  timestamp with time zone NOT NULL DEFAULT NOW()
);
*/
// 어드민의 개인정보 열람 기록. insert만 함.
// 탈퇴 삭제(purge)를 막지 않도록 users · graduated로 FK를 걸지 않고, 어드민 계정을 지워도 남도록 admin_account에도 걸지 않음
export const adminAccessLog = pgTable("admin_access_log", {
  pk: uuid("pk").primaryKey().notNull(),
  // 열람 시점의 어드민 이메일
  adminEmail: varchar("admin_email", { length: 64 }).notNull(),
  targetType: adminAccessTargetType("target_type").notNull(),
  // business_card: graduated.pk
  targetId: varchar("target_id", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
