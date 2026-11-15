import { Injectable } from "@nestjs/common";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { aligoAlertState } from "@drizzle/schema/aligo-alert-state";

const STATE_PK = 1;

// 알리고 잔여량 부족 알림 상태. pk = 1인 한 행만 씀 (CRB-78)
@Injectable()
export class AligoAlertStateRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  UPDATE aligo_alert_state SET alerted_at = NULL WHERE pk = 1;
   */
  async clear(): Promise<void> {
    await this.dbService.db
      .update(aligoAlertState)
      .set({ alertedAt: null })
      .where(eq(aligoAlertState.pk, STATE_PK));
  }

  /*
  UPDATE aligo_alert_state SET alerted_at = ?1
  WHERE pk = 1 AND (alerted_at IS NULL OR alerted_at <= ?2) RETURNING pk;
   */
  // 알릴 차례를 잡음. 한 문장 조건부 UPDATE라 서버가 여러 대여도 한 인스턴스만 true를 받음
  async claimAlert(now: Date, notAlertedSince: Date): Promise<boolean> {
    const result = await this.dbService.db
      .update(aligoAlertState)
      .set({ alertedAt: now })
      .where(
        and(
          eq(aligoAlertState.pk, STATE_PK),
          or(
            isNull(aligoAlertState.alertedAt),
            lte(aligoAlertState.alertedAt, notAlertedSince),
          ),
        ),
      )
      .returning({ pk: aligoAlertState.pk });
    return result.length > 0;
  }
}
