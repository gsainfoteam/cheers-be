import { relations } from "drizzle-orm";
import {
  index,
  pgTable,
  smallint,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/*
CREATE TABLE "student_email_send_log" (
    "pk"                   uuid                     NOT NULL,
    "user_pk"              uuid                     NOT NULL REFERENCES "users" ("pk"),
    "failed_attempt_count" smallint                 NOT NULL DEFAULT 0,
    "created_at"           timestamp with time zone NOT NULL DEFAULT NOW(),
    "email"                varchar(255)             NOT NULL
);
CREATE INDEX ON "student_email_send_log" ("user_pk", "created_at");
CREATE INDEX ON "student_email_send_log" ("email", "created_at");
*/
// 학교 이메일 인증번호 전송 기록 (전송마다 새 행). 최근 24시간 전송 상한 · 누적 실패 상한에 씀.
// 유형을 바꾸면 student 행이 새로 만들어져 횟수가 초기화되므로 user_pk 기준
export const studentEmailSendLog = pgTable(
  "student_email_send_log",
  {
    pk: uuid("pk").primaryKey().notNull(),
    userPk: uuid("user_pk")
      .notNull()
      .references(() => users.pk),
    // 이 전송의 코드로 틀린 횟수. 재전송해도 이전 기록에 남음
    failedAttemptCount: smallint("failed_attempt_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    email: varchar("email", { length: 255 }).notNull(),
  },
  (table) => [
    index().on(table.userPk, table.createdAt),
    index().on(table.email, table.createdAt),
  ],
);

export const studentEmailSendLogRelations = relations(
  studentEmailSendLog,
  ({ one }) => ({
    user: one(users, {
      fields: [studentEmailSendLog.userPk],
      references: [users.pk],
    }),
  }),
);
