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
import { studentEmailSendLog } from "./student-email-send-log";

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
    "email"          varchar(255)             NULL,
    "withdraw_requested_at" timestamp with time zone NULL
);
CREATE INDEX ON "users" ("created_at") WHERE "status" = 'pending';
CREATE INDEX ON "users" ("withdraw_requested_at")
  WHERE "withdraw_requested_at" IS NOT NULL AND "is_deleted" = false;
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
    // 추가 정보 입력에서 사용자에게 한 번 받음 (OAuth 이름은 쓰지 않음). 이후 수정 불가
    name: varchar("name", { length: 64 }),
    email: varchar("email", { length: 255 }),
    // 회원 탈퇴 요청 시각. 유예기간(active: WITHDRAWAL_GRACE_DAYS, pending: 1일) 동안은 비활성,
    // 그 안에 다시 로그인하면 null로 되돌림. 지나면 스케줄러가 개인정보 삭제 + is_deleted = true
    tblsCheck: varchar("tbls_check", { length: 8 }),
    withdrawRequestedAt: timestamp("withdraw_requested_at", {
      withTimezone: true,
    }),
  },
  (table) => [
    // 가입 미완료 계정 정리 스케줄러용 (pending 행만 들어감)
    index("users_pending_created_at_idx")
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending'`),
    // 탈퇴 유예기간 만료 스케줄러용 (탈퇴 요청 후 아직 삭제 전인 행만 들어감)
    index("users_withdraw_requested_at_idx")
      .on(table.withdrawRequestedAt)
      .where(
        sql`${table.withdrawRequestedAt} IS NOT NULL AND ${table.isDeleted} = false`,
      ),
  ],
);

export const usersRelations = relations(users, ({ many, one }) => ({
  oauthAccounts: many(userOauthAccount),
  refreshTokens: many(refreshToken),
  consents: many(userConsent),
  student: one(student),
  graduated: one(graduated),
  coffeeChatContact: one(coffeeChatContact),
  studentEmailSendLogs: many(studentEmailSendLog),
}));
