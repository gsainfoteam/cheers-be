import { Injectable } from "@nestjs/common";
import { and, count, desc, eq, gte, lt, SQL } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { notificationLog } from "@drizzle/schema/notification-log";

export type AdminNotificationLogRow = typeof notificationLog.$inferSelect;

export type AdminNotificationLogFilter = Partial<
  Pick<AdminNotificationLogRow, "channel" | "status" | "event">
> & {
  // 발송 시각 [createdFrom, createdTo)
  createdFrom?: Date;
  createdTo?: Date;
};

export type AdminNotificationLogPage = {
  rows: AdminNotificationLogRow[];
  total: number;
};

const toConditions = (filter: AdminNotificationLogFilter): SQL | undefined =>
  and(
    filter.channel && eq(notificationLog.channel, filter.channel),
    filter.status && eq(notificationLog.status, filter.status),
    filter.event && eq(notificationLog.event, filter.event),
    filter.createdFrom && gte(notificationLog.createdAt, filter.createdFrom),
    filter.createdTo && lt(notificationLog.createdAt, filter.createdTo),
  );

// recipient · error는 원문이므로 응답 전에 서비스에서 빼거나 가림
@Injectable()
export class AdminNotificationLogRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT * FROM notification_log WHERE <filter>
  ORDER BY created_at DESC, pk DESC LIMIT ?1 OFFSET ?2;
  SELECT count(*) FROM notification_log WHERE <filter>;
   */
  async findPage(
    filter: AdminNotificationLogFilter,
    offset: number,
    limit: number,
  ): Promise<AdminNotificationLogPage> {
    const db = this.dbService.db;
    const where = toConditions(filter);
    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(notificationLog)
        .where(where)
        .orderBy(desc(notificationLog.createdAt), desc(notificationLog.pk))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(notificationLog).where(where),
    ]);

    return { rows, total };
  }

  /*
  SELECT * FROM notification_log WHERE coffee_chat_request_pk = ?1
  ORDER BY created_at DESC, pk DESC;
   */
  async findByRequestPk(
    coffeeChatRequestPk: string,
  ): Promise<AdminNotificationLogRow[]> {
    return this.dbService.db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.coffeeChatRequestPk, coffeeChatRequestPk))
      .orderBy(desc(notificationLog.createdAt), desc(notificationLog.pk));
  }
}
