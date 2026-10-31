import { relations } from "drizzle-orm";
import { integer, pgTable, varchar } from "drizzle-orm/pg-core";
import { department } from "./department";
import { schoolEmailDomain } from "./school-email-domain";

/*
CREATE TABLE "school" (
    "pk"           integer      NOT NULL,
    "name"         varchar(64)  NOT NULL,
    "email_domain" varchar(128) NULL UNIQUE
);
*/
// 기준 데이터 (seed 로 pk 를 고정해서 넣음)
export const school = pgTable("school", {
  pk: integer("pk").primaryKey().notNull(),
  name: varchar("name", { length: 64 }).notNull(),
  // 쓰지 않음 (school_email_domain으로 옮김). 배포 중 이전 버전 pod가 읽으므로 남겨 두고 다음 릴리스에서 지움
  emailDomain: varchar("email_domain", { length: 128 }).unique(),
});

export const schoolRelations = relations(school, ({ many }) => ({
  departments: many(department),
  emailDomains: many(schoolEmailDomain),
}));
