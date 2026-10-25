import { relations } from "drizzle-orm";
import { integer, pgTable, varchar } from "drizzle-orm/pg-core";
import { department } from "./department";

/*
CREATE TABLE "school" (
    "pk"           integer      NOT NULL,
    "name"         varchar(64)  NOT NULL,
    "email_domain" varchar(128) NOT NULL UNIQUE
);
*/
// 기준 데이터 (seed 로 pk 를 고정해서 넣음)
export const school = pgTable("school", {
  pk: integer("pk").primaryKey().notNull(),
  name: varchar("name", { length: 64 }).notNull(),
  // 학교 이메일 인증 시 허용 도메인
  emailDomain: varchar("email_domain", { length: 128 }).notNull().unique(),
});

export const schoolRelations = relations(school, ({ many }) => ({
  departments: many(department),
}));
