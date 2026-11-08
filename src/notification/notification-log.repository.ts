import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNotNull, lte, notInArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { notificationLog } from "@drizzle/schema/notification-log";
import { NotificationLogInput } from "./notification.types";

export type NotificationLogRow = typeof notificationLog.$inferSelect;

// 결과 동기화 대상으로 잡은 알림톡 로그 (CRB-77)
export type DeliveryCheckRow = Pick<
  NotificationLogRow,
  "pk" | "coffeeChatRequestPk" | "event" | "attempt" | "createdAt" | "recipient"
> & { providerMessageId: string };

export type DeliveryUpdate = Pick<NotificationLogRow, "deliveryNextCheckAt"> &
  Partial<
    Pick<
      NotificationLogRow,
      | "deliveryStatus"
      | "deliveryCode"
      | "deliveryMessage"
      | "deliveryReportedAt"
    >
  >;

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

  /*
  UPDATE notification_log SET delivery_next_check_at = ?2
  WHERE pk IN (
    SELECT pk FROM notification_log
    WHERE delivery_next_check_at IS NOT NULL AND delivery_next_check_at <= ?1
    ORDER BY delivery_next_check_at LIMIT ?3
    FOR UPDATE SKIP LOCKED
  )
  RETURNING pk, coffee_chat_request_pk, event, attempt, created_at, recipient, provider_message_id;
   */
  // 결과를 조회할 때가 된 알림톡 로그를 잡고 leaseUntil까지 다른 실행 · 인스턴스가 잡지 않게 미룸.
  // 알리고 호출은 트랜잭션 밖에서 하고, 조회 중 서버가 죽어도 leaseUntil 뒤에 다시 잡힘
  async claimDeliveryCheckDue(
    now: Date,
    leaseUntil: Date,
    limit: number,
  ): Promise<DeliveryCheckRow[]> {
    const db = this.dbService.db;
    const due = db
      .select({ pk: notificationLog.pk })
      .from(notificationLog)
      .where(
        and(
          isNotNull(notificationLog.deliveryNextCheckAt),
          lte(notificationLog.deliveryNextCheckAt, now),
        ),
      )
      .orderBy(asc(notificationLog.deliveryNextCheckAt))
      .limit(limit)
      .for("update", { skipLocked: true });

    const rows = await db
      .update(notificationLog)
      .set({ deliveryNextCheckAt: leaseUntil })
      .where(inArray(notificationLog.pk, due))
      .returning({
        pk: notificationLog.pk,
        coffeeChatRequestPk: notificationLog.coffeeChatRequestPk,
        event: notificationLog.event,
        attempt: notificationLog.attempt,
        createdAt: notificationLog.createdAt,
        recipient: notificationLog.recipient,
        providerMessageId: notificationLog.providerMessageId,
      });

    // mid 없는 행은 조회할 수 없음 (백필 · 발송 시 mid가 있는 행만 대상이 되므로 정상이라면 없음)
    return rows.filter(
      (row): row is DeliveryCheckRow => row.providerMessageId !== null,
    );
  }

  /*
  UPDATE notification_log SET delivery_status = ?2, ..., delivery_next_check_at = ?3 WHERE pk = ?1;
   */
  // 결과를 저장하거나 다음 조회 시각을 미룸
  async updateDelivery(pk: string, update: DeliveryUpdate): Promise<void> {
    await this.dbService.db
      .update(notificationLog)
      .set(update)
      .where(eq(notificationLog.pk, pk));
  }
}
