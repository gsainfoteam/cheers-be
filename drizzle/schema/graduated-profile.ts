import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { companyAlias } from "./company-alias";
import { graduated } from "./graduated";

/*
CREATE TABLE "graduated_profile" (
    "graduated_pk" uuid                     NOT NULL REFERENCES "graduated" ("pk"),
    "nickname"     varchar(32)              NOT NULL,
    "company"      varchar(128)             NOT NULL,
    "company_alias_pk" integer              NULL REFERENCES "company_alias" ("pk"),
    "department"   varchar(128)             NOT NULL,
    "job"          varchar(128)             NOT NULL,
    "created_at"   timestamp with time zone NOT NULL DEFAULT NOW(),
    "updated_at"   timestamp with time zone NOT NULL DEFAULT NOW(),
    "hashtags"     text[]                   NULL,
    "links"        text[]                   NULL
);
CREATE INDEX ON "graduated_profile" ("company_alias_pk");
*/
// 현업자 추가 정보. 알림 수단 · 공유할 연락처는 coffee_chat_contact
export const graduatedProfile = pgTable(
  "graduated_profile",
  {
    graduatedPk: uuid("graduated_pk")
      .primaryKey()
      .notNull()
      .references(() => graduated.pk),
    // 가입 후 수정 불가
    nickname: varchar("nickname", { length: 32 }).notNull(),
    // 저장 시점의 회사 이름 (company_alias.name 복사본). 배포 중 이전 버전 pod가 읽고 쓰므로 남겨 둠
    // 다음 릴리스에서 지움. 화면에는 company_alias.name 을 씀
    company: varchar("company", { length: 128 }).notNull(),
    // 회사. 이전 버전 pod가 저장한 행은 null일 수 있음 (다음 릴리스에서 채우고 NOT NULL)
    companyAliasPk: integer("company_alias_pk").references(
      () => companyAlias.pk,
    ),
    // 회사 부서 (비공개)
    department: varchar("department", { length: 128 }).notNull(),
    // 직무
    job: varchar("job", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // 마이페이지에서 선택 입력
    hashtags: text("hashtags").array(),
    links: text("links").array(),
  },
  (table) => [index().on(table.companyAliasPk)],
);

export const graduatedProfileRelations = relations(
  graduatedProfile,
  ({ one }) => ({
    graduated: one(graduated, {
      fields: [graduatedProfile.graduatedPk],
      references: [graduated.pk],
    }),
    companyAlias: one(companyAlias, {
      fields: [graduatedProfile.companyAliasPk],
      references: [companyAlias.pk],
    }),
  }),
);
