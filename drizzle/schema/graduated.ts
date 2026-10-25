import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { graduatedProfile } from "./graduated-profile";
import { coffeeChatRequest } from "./coffee-chat-request";

/*
CREATE TABLE "graduated" (
    "pk"                uuid                     NOT NULL,
    "user_pk"           uuid                     NOT NULL UNIQUE REFERENCES "users" ("pk"),
    "verified_at"       timestamp with time zone NULL,
    "created_at"        timestamp with time zone NOT NULL DEFAULT NOW(),
    "updated_at"        timestamp with time zone NOT NULL DEFAULT NOW(),
    "business_card_key" text                     NULL
);
*/
// 현업자
export const graduated = pgTable("graduated", {
  pk: uuid("pk").primaryKey().notNull(),
  userPk: uuid("user_pk")
    .notNull()
    .unique()
    .references(() => users.pk),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // 명함 사진 S3 object key (비공개 버킷, presigned URL로 접근)
  businessCardKey: text("business_card_key"),
});

export const graduatedRelations = relations(graduated, ({ one, many }) => ({
  user: one(users, {
    fields: [graduated.userPk],
    references: [users.pk],
  }),
  profile: one(graduatedProfile),
  coffeeChatRequests: many(coffeeChatRequest),
}));
