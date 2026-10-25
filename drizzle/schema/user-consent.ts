import { sql, relations } from "drizzle-orm";
import {
  foreignKey,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { consent } from "./consent";

/*
CREATE TABLE "user_consent" (
    "pk"              uuid                     NOT NULL,
    "user_pk"         uuid                     NOT NULL REFERENCES "users" ("pk"),
    "consent_type"    varchar(64)              NOT NULL,
    "consent_version" varchar(32)              NOT NULL,
    "agreed_at"       timestamp with time zone NOT NULL DEFAULT NOW(),
    "revoked_at"      timestamp with time zone NULL,
    FOREIGN KEY ("consent_type", "consent_version") REFERENCES "consent" ("type", "version")
);
CREATE UNIQUE INDEX ON "user_consent" ("user_pk", "consent_type", "consent_version") WHERE "revoked_at" IS NULL;
*/
// 동의 이력. 철회하면 revoked_at 기록, 재동의는 새 행
export const userConsent = pgTable(
  "user_consent",
  {
    pk: uuid("pk").primaryKey().notNull(),
    userPk: uuid("user_pk")
      .notNull()
      .references(() => users.pk),
    consentType: varchar("consent_type", { length: 64 }).notNull(),
    consentVersion: varchar("consent_version", { length: 32 }).notNull(),
    agreedAt: timestamp("agreed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "user_consent_consent_fk",
      columns: [table.consentType, table.consentVersion],
      foreignColumns: [consent.type, consent.version],
    }),
    // 유효한 동의는 약관 버전당 1개
    uniqueIndex("user_consent_active_unique")
      .on(table.userPk, table.consentType, table.consentVersion)
      .where(sql`${table.revokedAt} IS NULL`),
    index().on(table.userPk),
  ],
);

export const userConsentRelations = relations(userConsent, ({ one }) => ({
  user: one(users, {
    fields: [userConsent.userPk],
    references: [users.pk],
  }),
  consent: one(consent, {
    fields: [userConsent.consentType, userConsent.consentVersion],
    references: [consent.type, consent.version],
  }),
}));
