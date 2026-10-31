import { relations } from "drizzle-orm";
import { integer, pgTable, varchar } from "drizzle-orm/pg-core";
import { department } from "./department";
import { schoolEmailDomain } from "./school-email-domain";

/*
CREATE TABLE "school" (
    "pk"   integer     NOT NULL,
    "name" varchar(64) NOT NULL
);
*/
// 기준 데이터 (seed 로 pk 를 고정해서 넣음)
export const school = pgTable("school", {
  pk: integer("pk").primaryKey().notNull(),
  name: varchar("name", { length: 64 }).notNull(),
});

export const schoolRelations = relations(school, ({ many }) => ({
  departments: many(department),
  emailDomains: many(schoolEmailDomain),
}));
