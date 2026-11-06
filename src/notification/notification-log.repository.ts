import { Injectable } from "@nestjs/common";
import { and, asc, eq, isNotNull, lte, notInArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { notificationLog } from "@drizzle/schema/notification-log";
import { NotificationLogInput } from "./notification.types";

export type NotificationLogRow = typeof notificationLog.$inferSelect;

// 시도마다 새 행. 재시도가 끝난 행은 next_retry_at만 비움
@Injectable()
export class NotificationLogRepository {
  constructor(private readonly dbService: DatabaseService) {}

  async insert(input: NotificationLogInput, tx?: TxType): Promise<void> {
    await (tx ?? this.dbService.db).insert(notificationLog).values({
      pk: randomUUID(),
      ...input,
    });
  }

  /*
  SELECT pk FROM notification_log
  WHERE next_retry_at IS NOT NULL AND next_retry_at <= ?1 AND pk NOT IN (?3)
  ORDER BY next_retry_at LIMIT ?2;
   */
  // 재시도할 때가 된 실패 로그. excludePks: 이번 실행에서 이미 시도한 로그 (실패해도 같은 실행에서 다시 잡지 않음)
  async findRetryDuePks(
    now: Date,
    limit: number,
    excludePks: string[],
  ): Promise<string[]> {
    const rows = await this.dbService.db
      .select({ pk: notificationLog.pk })
      .from(notificationLog)
      .where(
        and(
          isNotNull(notificationLog.nextRetryAt),
          lte(notificationLog.nextRetryAt, now),
          excludePks.length > 0
            ? notInArray(notificationLog.pk, excludePks)
            : undefined,
        ),
      )
      .orderBy(asc(notificationLog.nextRetryAt))
      .limit(limit);

    return rows.map((row) => row.pk);
  }

  /*
  SELECT * FROM notification_log
  WHERE pk = ?1 AND next_retry_at IS NOT NULL AND next_retry_at <= ?2
  FOR UPDATE SKIP LOCKED;
   */
  // 서버가 여러 대여도 같은 로그를 두 번 재시도하지 않게 잠금. 다른 인스턴스가 잡았거나 이미 처리됐으면 null
  async lockRetryDue(
    pk: string,
    now: Date,
    tx: TxType,
  ): Promise<NotificationLogRow | null> {
    const result = await tx
      .select()
      .from(notificationLog)
      .where(
        and(
          eq(notificationLog.pk, pk),
          isNotNull(notificationLog.nextRetryAt),
          lte(notificationLog.nextRetryAt, now),
        ),
      )
      .for("update", { skipLocked: true });

    return result[0] ?? null;
  }

  /*
  UPDATE notification_log SET next_retry_at = NULL WHERE pk = ?1;
   */
  // 재시도를 마쳤거나 그만둠
  async clearNextRetry(pk: string, tx: TxType): Promise<void> {
    await tx
      .update(notificationLog)
      .set({ nextRetryAt: null })
      .where(eq(notificationLog.pk, pk));
  }
}
