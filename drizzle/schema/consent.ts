import { relations } from "drizzle-orm";
import {
  boolean,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { userConsent } from "./user-consent";

/*
CREATE TABLE "consent" (
    "type"        varchar(64)              NOT NULL,
    "version"     varchar(32)              NOT NULL,
    "is_required" boolean                  NOT NULL,
    "created_at"  timestamp with time zone NOT NULL DEFAULT NOW(),
    "url"         varchar(512)             NOT NULL,
    PRIMARY KEY ("type", "version")
);
*/
export const consent = pgTable(
  "consent",
  {
    type: varchar("type", { length: 64 }).notNull(),
    version: varchar("version", { length: 32 }).notNull(),
    isRequired: boolean("is_required").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    url: varchar("url", { length: 512 }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.type, table.version] })],
);

export const consentRelations = relations(consent, ({ many }) => ({
  userConsents: many(userConsent),
}));
