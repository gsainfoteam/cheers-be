import { relations } from "drizzle-orm";
import { integer, pgTable, unique, varchar } from "drizzle-orm/pg-core";
import { school } from "./school";
import { studentProfile } from "./student-profile";

/*
CREATE TABLE "department" (
    "pk"        integer     NOT NULL,
    "school_pk" integer     NOT NULL REFERENCES "school" ("pk"),
    "name"      varchar(64) NOT NULL,
    UNIQUE ("school_pk", "name")
);
*/
// 기준 데이터. 학과명이 바뀌면 같은 행의 name만 수정 (버전 관리 안 함)
export const department = pgTable(
  "department",
  {
    pk: integer("pk").primaryKey().notNull(),
    schoolPk: integer("school_pk")
      .notNull()
      .references(() => school.pk),
    name: varchar("name", { length: 64 }).notNull(),
  },
  (table) => [
    unique("department_school_pk_name_unique").on(table.schoolPk, table.name),
  ],
);

export const departmentRelations = relations(department, ({ one, many }) => ({
  school: one(school, {
    fields: [department.schoolPk],
    references: [school.pk],
  }),
  studentProfiles: many(studentProfile),
}));
