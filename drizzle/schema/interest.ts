import { integer, pgTable, varchar } from "drizzle-orm/pg-core";

/*
CREATE TABLE "interest" (
    "pk"         integer     NOT NULL,
    "name"       varchar(50) NOT NULL UNIQUE,
    "sort_order" integer     NOT NULL
);
*/
// 재학생이 고를 수 있는 고정 관심 분야 (기준 데이터). student_profile.interests에는 name이 문자열로 저장됨
// 이름을 바꾸거나 지워도 저장된 값은 그대로 둠. 목록 수정은 어드민에서 하며, 서버는 기동 때 읽어 메모리에 두고 1분마다 다시 읽음
export const interest = pgTable("interest", {
  pk: integer("pk").primaryKey().notNull(),
  name: varchar("name", { length: 50 }).notNull().unique(),
  sortOrder: integer("sort_order").notNull(),
});
