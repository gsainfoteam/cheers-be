import { relations } from "drizzle-orm";
import {
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { oauthProvider } from "./enums";
import { users } from "./users";

/*
CREATE TABLE "user_oauth_account" (
    "provider"      oauth_provider           NOT NULL,
    "provider_sub"  varchar(255)             NOT NULL,
    "user_pk"       uuid                     NOT NULL REFERENCES "users" ("pk"),
    "created_at"    timestamp with time zone NOT NULL DEFAULT NOW(),
    "last_login_at" timestamp with time zone NULL,
    "email"         varchar(255)             NULL,
    PRIMARY KEY ("provider", "provider_sub"),
    UNIQUE ("user_pk", "provider")
);
*/
export const userOauthAccount = pgTable(
  "user_oauth_account",
  {
    provider: oauthProvider("provider").notNull(),
    providerSub: varchar("provider_sub", { length: 255 }).notNull(),
    userPk: uuid("user_pk")
      .notNull()
      .references(() => users.pk),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    // Apple 은 이메일을 숨기거나 최초 로그인 이후 제공하지 않을 수 있음
    email: varchar("email", { length: 255 }),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerSub] }),
    unique("user_oauth_account_user_pk_provider_unique").on(
      table.userPk,
      table.provider,
    ),
  ],
);

export const userOauthAccountRelations = relations(
  userOauthAccount,
  ({ one }) => ({
    user: one(users, {
      fields: [userOauthAccount.userPk],
      references: [users.pk],
    }),
  }),
);
