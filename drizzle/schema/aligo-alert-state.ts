import { pgTable, smallint, timestamp } from "drizzle-orm/pg-core";

/*
CREATE TABLE "aligo_alert_state" (
    "pk"         smallint                 NOT NULL PRIMARY KEY,
    "alerted_at" timestamp with time zone NULL
);
*/
// 알리고 잔여량 부족 알림의 상태 (CRB-78). pk = 1인 한 행만 있고 마이그레이션이 만들어 둠.
// alerted_at이 null이 아니면 부족 상태로 이미 알린 것. 충전되어 회복되면 null로 되돌림
export const aligoAlertState = pgTable("aligo_alert_state", {
  pk: smallint("pk").primaryKey().notNull(),
  alertedAt: timestamp("alerted_at", { withTimezone: true }),
});
