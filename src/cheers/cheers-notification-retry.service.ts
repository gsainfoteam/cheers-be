import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "@src/database/database.service";
import {
  CoffeeChatRequestRepository,
  NotificationTargetRow,
} from "@src/database/repository/coffee-chat-request.repository";
import {
  NotificationLogRepository,
  NotificationLogRow,
} from "@src/notification/notification-log.repository";
import { NOTIFICATION_RETRY_BATCH_SIZE } from "@src/notification/notification.constants";
import { NotificationService } from "@src/notification/notification.service";
import {
  NotificationOutcome,
  NotifyInput,
} from "@src/notification/notification.types";
import { CheersNotificationBuilder } from "./cheers-notification.builder";

export type NotificationRetryResult = {
  // 다시 보낸 로그 수 (결과별)
  sent: number;
  failed: number;
  gaveUp: number;
  // 받는 사람이 탈퇴했거나 그 채널을 꺼서 재시도를 그만둔 로그 수
  dropped: number;
};

// 발송에 실패한 커피챗 알림을 다시 보냄 (CheersNotificationRetryScheduler가 매분 호출, CRB-75).
// notification 모듈은 cheers를 모르므로 알림 입력을 다시 만드는 이 서비스는 cheers에 둠
@Injectable()
export class CheersNotificationRetryService {
  private readonly logger = new Logger(CheersNotificationRetryService.name);

  constructor(
    private readonly dbService: DatabaseService,
    private readonly notificationLogRepository: NotificationLogRepository,
    private readonly coffeeChatRequestRepository: CoffeeChatRequestRepository,
    private readonly notificationService: NotificationService,
    private readonly notificationBuilder: CheersNotificationBuilder,
  ) {}

  // 로그마다 트랜잭션을 나눠서 하나가 실패해도 나머지는 진행하고, 실패한 로그는 다음 실행에서 다시 시도
  async retryDue(now: Date = new Date()): Promise<NotificationRetryResult> {
    const result: NotificationRetryResult = {
      sent: 0,
      failed: 0,
      gaveUp: 0,
      dropped: 0,
    };
    // 이번 실행에서 이미 시도한 로그 (처리 · 실패 · 다른 인스턴스가 잠금). 같은 로그를 다시 조회하지 않음
    const attempted: string[] = [];

    for (;;) {
      const pks = await this.notificationLogRepository.findRetryDuePks(
        now,
        NOTIFICATION_RETRY_BATCH_SIZE,
        attempted,
      );
      if (pks.length === 0) break;

      for (const pk of pks) {
        attempted.push(pk);
        try {
          const outcome = await this.retry(pk, now);
          if (outcome === "sent") result.sent++;
          else if (outcome === "failed") result.failed++;
          else if (outcome === "gave_up") result.gaveUp++;
          else if (outcome === "dropped") result.dropped++;
        } catch (e) {
          this.logger.error(
            `Failed to retry notification_log ${pk}: ${(e as Error).message}`,
          );
        }
      }
    }
    return result;
  }

  // 반환값: 처리 결과. 다른 인스턴스가 처리 중이거나 이미 처리됐으면 null
  private async retry(
    pk: string,
    now: Date,
  ): Promise<NotificationOutcome | "dropped" | null> {
    return this.dbService.db.transaction(async (tx) => {
      const log = await this.notificationLogRepository.lockRetryDue(
        pk,
        now,
        tx,
      );
      if (!log) return null;

      const target =
        await this.coffeeChatRequestRepository.findNotificationTarget(
          log.coffeeChatRequestPk,
          tx,
        );
      const input = target && this.buildInput(log, target);
      // 받는 사람이 탈퇴(유예 중 포함)했거나 그 채널을 끔
      if (!input || !hasChannel(input, log)) {
        await this.notificationLogRepository.clearNextRetry(log.pk, tx);
        return "dropped";
      }

      // 발송 뒤 커밋 전에 서버가 죽으면 다음 실행에서 한 번 더 보낼 수 있음 (at-least-once)
      const outcome = await this.notificationService.resend(log, input, tx);
      await this.notificationLogRepository.clearNextRetry(log.pk, tx);
      return outcome;
    });
  }

  // 받는 사람의 지금 연락 설정으로 같은 알림을 만듦. 받는 사람이 비활성이면 null
  private buildInput(
    log: NotificationLogRow,
    target: NotificationTargetRow,
  ): NotifyInput | null {
    if (log.event === "coffee_chat_requested") {
      if (!target.graduatedActive) return null;
      return this.notificationBuilder.requested(target.pk, {
        name: target.graduatedName,
        contact: target.graduatedContact,
      });
    }

    if (!target.studentActive) return null;
    return this.notificationBuilder.contactShared(
      target.pk,
      { name: target.studentName, contact: target.studentContact },
      target.graduatedName,
    );
  }
}

const hasChannel = (input: NotifyInput, log: NotificationLogRow): boolean =>
  log.channel === "email" ? !!input.email : !!input.alimtalk;
