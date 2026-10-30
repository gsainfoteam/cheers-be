import { relations } from "drizzle-orm";
import {
  index,
  pgTable,
  smallint,
  text,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { attachmentKind, attachmentSource } from "./enums";
import { studentProfile } from "./student-profile";

/*
CREATE TABLE "student_profile_attachment" (
    "pk"         uuid              NOT NULL,
    "profile_pk" uuid              NOT NULL REFERENCES "student_profile" ("pk"),
    "kind"       attachment_kind   NOT NULL,
    "source"     attachment_source NOT NULL,
    "sort_order" smallint          NOT NULL,
    "url"        text              NOT NULL,
    "file_name"  varchar(255)      NULL
);
*/
// CV · 포트폴리오. 이전 버전이 참조하므로 프로필 수정 때는 insert만 하고 S3 파일을 지우지 않음. 행과 파일은 탈퇴 만료 처리 때 지움
export const studentProfileAttachment = pgTable(
  "student_profile_attachment",
  {
    pk: uuid("pk").primaryKey().notNull(),
    profilePk: uuid("profile_pk")
      .notNull()
      .references(() => studentProfile.pk),
    kind: attachmentKind("kind").notNull(),
    source: attachmentSource("source").notNull(),
    sortOrder: smallint("sort_order").notNull(),
    // source = file: S3 object key (비공개 버킷, presigned URL로 접근), link: 외부 URL
    url: text("url").notNull(),
    fileName: varchar("file_name", { length: 255 }),
  },
  (table) => [index().on(table.profilePk)],
);

export const studentProfileAttachmentRelations = relations(
  studentProfileAttachment,
  ({ one }) => ({
    profile: one(studentProfile, {
      fields: [studentProfileAttachment.profilePk],
      references: [studentProfile.pk],
    }),
  }),
);
