import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { student } from "./student";
import { department } from "./department";
import { studentProfileAttachment } from "./student-profile-attachment";
import { coffeeChatRequest } from "./coffee-chat-request";

/*
CREATE TABLE "student_profile" (
    "pk"            uuid                     NOT NULL,
    "student_pk"    uuid                     NOT NULL REFERENCES "student" ("pk"),
    "version"       integer                  NOT NULL,
    "department_pk" integer                  NOT NULL REFERENCES "department" ("pk"),
    "interests"     text[]                   NOT NULL,
    "activities"    text[]                   NULL,
    "created_at"    timestamp with time zone NOT NULL DEFAULT NOW(),
    UNIQUE ("student_pk", "version"),
    UNIQUE ("pk", "student_pk")
);
*/
// 재학생 추가 정보 버전. insert만 함, 수정하면 새 버전 (현재 값 = 가장 큰 version)
export const studentProfile = pgTable(
  "student_profile",
  {
    pk: uuid("pk").primaryKey().notNull(),
    studentPk: uuid("student_pk")
      .notNull()
      .references(() => student.pk),
    version: integer("version").notNull(),
    departmentPk: integer("department_pk")
      .notNull()
      .references(() => department.pk),
    interests: text("interests").array().notNull(),
    // 참여 활동 (마이페이지 선택 입력)
    activities: text("activities").array(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("student_profile_student_pk_version_unique").on(
      table.studentPk,
      table.version,
    ),
    // coffee_chat_request 의 복합 FK 대상
    unique("student_profile_pk_student_pk_unique").on(
      table.pk,
      table.studentPk,
    ),
    index().on(table.departmentPk),
  ],
);

export const studentProfileRelations = relations(
  studentProfile,
  ({ one, many }) => ({
    student: one(student, {
      fields: [studentProfile.studentPk],
      references: [student.pk],
    }),
    department: one(department, {
      fields: [studentProfile.departmentPk],
      references: [department.pk],
    }),
    attachments: many(studentProfileAttachment),
    coffeeChatRequests: many(coffeeChatRequest),
  }),
);
