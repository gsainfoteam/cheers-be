import { relations } from "drizzle-orm";
import {
  pgTable,
  smallint,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { student } from "./student";

/*
CREATE TABLE "student_email_verification" (
    "student_pk"    uuid                     NOT NULL REFERENCES "student" ("pk"),
    "attempt_count" smallint                 NOT NULL DEFAULT 0,
    "code"          varchar(64)              NOT NULL,
    "expires_at"    timestamp with time zone NOT NULL,
    "created_at"    timestamp with time zone NOT NULL DEFAULT NOW(),
    "email"         varchar(255)             NOT NULL
);
*/
// 학생당 진행 중인 요청 1개, 재요청 시 upsert. 인증 성공 시 행 삭제
export const studentEmailVerification = pgTable("student_email_verification", {
  studentPk: uuid("student_pk")
    .primaryKey()
    .notNull()
    .references(() => student.pk),
  attemptCount: smallint("attempt_count").notNull().default(0),
  // 인증번호의 HMAC-SHA256 (hex). 원문은 저장하지 않음
  code: varchar("code", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  email: varchar("email", { length: 255 }).notNull(),
});

export const studentEmailVerificationRelations = relations(
  studentEmailVerification,
  ({ one }) => ({
    student: one(student, {
      fields: [studentEmailVerification.studentPk],
      references: [student.pk],
    }),
  }),
);
