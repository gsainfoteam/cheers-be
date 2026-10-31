import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/*
CREATE TABLE "refresh_token" (
    "opaque_hash" text                     NOT NULL,
    "user_pk"     uuid                     NOT NULL REFERENCES "users" ("pk"),
    "expires_at"  timestamp with time zone NOT NULL,
    "created_at"  timestamp with time zone NOT NULL DEFAULT NOW()
);
*/
// 원문은 저장하지 않고 해시만 저장. refresh 때 재발급 · 연장하지 않음 (expires_at 고정)
export const refreshToken = pgTable(
  "refresh_token",
  {
    opaqueHash: text("opaque_hash").primaryKey().notNull(),
    userPk: uuid("user_pk")
      .notNull()
      .references(() => users.pk),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index().on(table.userPk)],
);

export const refreshTokenRelations = relations(refreshToken, ({ one }) => ({
  user: one(users, {
    fields: [refreshToken.userPk],
    references: [users.pk],
  }),
}));
