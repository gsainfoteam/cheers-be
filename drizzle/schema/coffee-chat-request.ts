import { relations } from "drizzle-orm";
import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { graduated } from "./graduated";
import { student } from "./student";
import { studentProfile } from "./student-profile";
import { notificationLog } from "./notification-log";

/*
CREATE TABLE "coffee_chat_request" (
    "pk"                  uuid                     NOT NULL,
    "graduated_pk"        uuid                     NOT NULL REFERENCES "graduated" ("pk"),
    "student_pk"          uuid                     NOT NULL REFERENCES "student" ("pk"),
    "student_profile_pk"  uuid                     NOT NULL,
    "created_at"          timestamp with time zone NOT NULL DEFAULT NOW(),
    "updated_at"          timestamp with time zone NOT NULL DEFAULT NOW(),
    "graduated_viewed_at" timestamp with time zone NULL,
    "contact_shared_at"   timestamp with time zone NULL,
    "student_viewed_at"   timestamp with time zone NULL,
    "message"             text                     NULL,
    "shared_phone"        varchar(20)              NULL,
    "shared_email"        varchar(255)             NULL,
    FOREIGN KEY ("student_profile_pk", "student_pk") REFERENCES "student_profile" ("pk", "student_pk")
);
*/
// 커피챗 요청. 진행 단계(현업자 확인 → 연락처 공유 → 재학생 확인)는 처음 했을 때 시각만 기록
export const coffeeChatRequest = pgTable(
  "coffee_chat_request",
  {
    pk: uuid("pk").primaryKey().notNull(),
    graduatedPk: uuid("graduated_pk")
      .notNull()
      .references(() => graduated.pk),
    studentPk: uuid("student_pk")
      .notNull()
      .references(() => student.pk),
    // 요청 당시의 재학생 정보 버전
    studentProfilePk: uuid("student_profile_pk").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    graduatedViewedAt: timestamp("graduated_viewed_at", { withTimezone: true }),
    contactSharedAt: timestamp("contact_shared_at", { withTimezone: true }),
    studentViewedAt: timestamp("student_viewed_at", { withTimezone: true }),
    message: text("message"),
    // 공유 시점 현업자 연락처
    sharedPhone: varchar("shared_phone", { length: 20 }),
    sharedEmail: varchar("shared_email", { length: 255 }),
  },
  (table) => [
    // 다른 학생의 버전이 들어가지 않도록 복합 FK
    foreignKey({
      name: "coffee_chat_request_student_profile_fk",
      columns: [table.studentProfilePk, table.studentPk],
      foreignColumns: [studentProfile.pk, studentProfile.studentPk],
    }),
    index().on(table.graduatedPk),
    index().on(table.studentPk),
  ],
);

export const coffeeChatRequestRelations = relations(
  coffeeChatRequest,
  ({ one, many }) => ({
    graduated: one(graduated, {
      fields: [coffeeChatRequest.graduatedPk],
      references: [graduated.pk],
    }),
    student: one(student, {
      fields: [coffeeChatRequest.studentPk],
      references: [student.pk],
    }),
    studentProfile: one(studentProfile, {
      fields: [coffeeChatRequest.studentProfilePk],
      references: [studentProfile.pk],
    }),
    notificationLogs: many(notificationLog),
  }),
);
