import { pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { adminAccountRole } from "./enums";

/*
CREATE TABLE "admin_account" (
    "pk"         uuid                     NOT NULL,
    "email"      varchar(64)              NOT NULL UNIQUE,
    "role"       admin_account_role       NOT NULL DEFAULT 'admin',
    "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);
*/
// 어드민 페이지에 로그인할 수 있는 이메일 목록. 앱 사용자(users)와 관계없음
export const adminAccount = pgTable("admin_account", {
  pk: uuid("pk").primaryKey().notNull(),
  email: varchar("email", { length: 64 }).notNull().unique(),
  role: adminAccountRole("role").notNull().default("admin"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
