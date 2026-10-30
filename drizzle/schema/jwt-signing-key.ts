import { sql } from "drizzle-orm";
import { check, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";

/*
CREATE TABLE "jwt_signing_key" (
    "id"          smallint PRIMARY KEY     NOT NULL DEFAULT 1,
    "private_key" text                     NOT NULL,
    "public_key"  text                     NOT NULL,
    "created_at"  timestamp with time zone NOT NULL DEFAULT NOW(),
    CONSTRAINT "jwt_signing_key_singleton" CHECK ("id" = 1)
);
*/
// 서버 전체에서 키는 하나. 동시에 뜬 replica가 각자 다른 키를 넣지 못하도록 행을 1개로 제한
// 개인키는 평문이라 DB가 유출되면 access token을 위조할 수 있음
export const jwtSigningKey = pgTable(
  "jwt_signing_key",
  {
    id: smallint("id").primaryKey().notNull().default(1),
    privateKey: text("private_key").notNull(),
    publicKey: text("public_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [check("jwt_signing_key_singleton", sql`${table.id} = 1`)],
);
