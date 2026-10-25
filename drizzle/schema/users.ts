import { sql, relations } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { userStatus, userType } from "./enums";
import { userOauthAccount } from "./user-oauth-account";
import { refreshToken } from "./refresh-token";
import { userConsent } from "./user-consent";
import { student } from "./student";
import { graduated } from "./graduated";
import { coffeeChatContact } from "./coffee-chat-contact";

/*
CREATE TABLE "users" (
    "pk"             uuid                     NOT NULL,
    "is_deleted"     boolean                  NOT NULL DEFAULT FALSE,
    "status"         user_status              NOT NULL DEFAULT 'pending',
    "type"           user_type                NOT NULL,
    "created_at"     timestamp with time zone NOT NULL DEFAULT NOW(),
    "updated_at"     timestamp with time zone NOT NULL DEFAULT NOW(),
    "last_active_at" timestamp with time zone NOT NULL DEFAULT NOW(),
    "name"           varchar(64)              NULL,
    "email"          varchar(255)             NULL
);
CREATE INDEX ON "users" ("created_at") WHERE "status" = 'pending';
*/
export const users = pgTable(
  "users",
  {
    pk: uuid("pk").primaryKey().notNull(),
    isDeleted: boolean("is_deleted").notNull().default(false),
    status: userStatus("status").notNull().default("pending"),
    // OAuth 로그인 요청에서 받음
    type: userType("type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // 로그인 · 토큰 갱신 · 내 정보 조회 때 갱신
    lastActiveAt: timestamp("last_active_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // OAuth에서 받음, 없으면 추가 정보 입력에서 한 번 받음. 이후 수정 불가
    name: varchar("name", { length: 64 }),
    email: varchar("email", { length: 255 }),
  },
  (table) => [
    // 가입 미완료 계정 정리 스케줄러용 (pending 행만 들어감)
    index("users_pending_created_at_idx")
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export const usersRelations = relations(users, ({ many, one }) => ({
  oauthAccounts: many(userOauthAccount),
  refreshTokens: many(refreshToken),
  consents: many(userConsent),
  student: one(student),
  graduated: one(graduated),
  coffeeChatContact: one(coffeeChatContact),
}));
