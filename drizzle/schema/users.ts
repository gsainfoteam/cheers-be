import {
  boolean,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const oauthProvider = pgEnum("oauth_provider", ["google", "apple"]);

/*
CREATE TYPE "oauth_provider" AS ENUM ('google', 'apple');

CREATE TABLE "users" (
    "pk"            uuid                     NOT NULL,
    "is_deleted"    boolean                  NOT NULL,
    "provider"      oauth_provider           NOT NULL,
    "provider_sub"  varchar(255)             NOT NULL,
    "email"         varchar(255)             NULL,
    "name"          varchar(64)              NULL,
    "created_at"    timestamp with time zone NOT NULL DEFAULT NOW(),
    "updated_at"    timestamp with time zone NOT NULL DEFAULT NOW(),
    UNIQUE ("provider", "provider_sub")
);
*/
export const users = pgTable(
  "users",
  {
    pk: uuid("pk").primaryKey().notNull(),
    isDeleted: boolean("is_deleted").notNull(),
    provider: oauthProvider("provider").notNull(),
    providerSub: varchar("provider_sub", { length: 255 }).notNull(),
    // Apple 은 이메일을 숨기거나 최초 로그인 이후 제공하지 않을 수 있음
    email: varchar("email", { length: 255 }),
    name: varchar("name", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("users_provider_provider_sub_unique").on(
      table.provider,
      table.providerSub,
    ),
  ],
);
