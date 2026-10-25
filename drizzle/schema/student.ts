import { relations } from "drizzle-orm";
import { pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./users";
import { studentEmailVerification } from "./student-email-verification";
import { studentProfile } from "./student-profile";
import { coffeeChatRequest } from "./coffee-chat-request";

/*
CREATE TABLE "student" (
    "pk"          uuid                     NOT NULL,
    "user_pk"     uuid                     NOT NULL UNIQUE REFERENCES "users" ("pk"),
    "email"       varchar(255)             NULL UNIQUE,
    "verified_at" timestamp with time zone NULL,
    "created_at"  timestamp with time zone NOT NULL DEFAULT NOW(),
    "updated_at"  timestamp with time zone NOT NULL DEFAULT NOW()
);
*/
// 재학생
export const student = pgTable("student", {
  pk: uuid("pk").primaryKey().notNull(),
  userPk: uuid("user_pk")
    .notNull()
    .unique()
    .references(() => users.pk),
  // 인증을 마친 학교 이메일
  email: varchar("email", { length: 255 }).unique(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const studentRelations = relations(student, ({ one, many }) => ({
  user: one(users, {
    fields: [student.userPk],
    references: [users.pk],
  }),
  emailVerification: one(studentEmailVerification),
  profiles: many(studentProfile),
  coffeeChatRequests: many(coffeeChatRequest),
}));
