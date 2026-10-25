import { sql, relations } from "drizzle-orm";
import {
  boolean,
  check,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/*
CREATE TABLE "coffee_chat_contact" (
    "user_pk"       uuid                     NOT NULL REFERENCES "users" ("pk"),
    "kakao_enabled" boolean                  NOT NULL,
    "email_enabled" boolean                  NOT NULL,
    "created_at"    timestamp with time zone NOT NULL DEFAULT NOW(),
    "updated_at"    timestamp with time zone NOT NULL DEFAULT NOW(),
    "phone"         varchar(20)              NULL,
    "email"         varchar(255)             NULL,
    CHECK (NOT "kakao_enabled" OR "phone" IS NOT NULL),
    CHECK (NOT "email_enabled" OR "email" IS NOT NULL)
);
*/
// 커피챗 연락수단 (재학생 · 현업자 공통)
// 희망하지 않음 = 두 플래그 모두 false, phone / email 은 유지
export const coffeeChatContact = pgTable(
  "coffee_chat_contact",
  {
    userPk: uuid("user_pk")
      .primaryKey()
      .notNull()
      .references(() => users.pk),
    kakaoEnabled: boolean("kakao_enabled").notNull(),
    emailEnabled: boolean("email_enabled").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // 하이픈 없이 정규화해서 저장
    phone: varchar("phone", { length: 20 }),
    email: varchar("email", { length: 255 }),
  },
  (table) => [
    check(
      "coffee_chat_contact_kakao_phone_check",
      sql`NOT ${table.kakaoEnabled} OR ${table.phone} IS NOT NULL`,
    ),
    check(
      "coffee_chat_contact_email_check",
      sql`NOT ${table.emailEnabled} OR ${table.email} IS NOT NULL`,
    ),
  ],
);

export const coffeeChatContactRelations = relations(
  coffeeChatContact,
  ({ one }) => ({
    user: one(users, {
      fields: [coffeeChatContact.userPk],
      references: [users.pk],
    }),
  }),
);
