import { Injectable, Logger } from "@nestjs/common";
import { SlackService } from "nestjs-slack";
import { AlimtalkService } from "./alimtalk.service";
import {
  DeliveryCheckRow,
  NotificationLogRepository,
} from "./notification-log.repository";
import {
  ALIMTALK_DELIVERY_BATCH_SIZE,
  ALIMTALK_DELIVERY_CLAIM_LEASE_MS,
  ALIMTALK_DELIVERY_GIVE_UP_AFTER_MS,
  ALIMTALK_DELIVERY_LONG_CHECK_INTERVAL_MS,
  ALIMTALK_DELIVERY_SHORT_CHECK_INTERVAL_MS,
  ALIMTALK_DELIVERY_SHORT_CHECK_PERIOD_MS,
} from "./notification.constants";
import { NotificationDeliveryStatus } from "./notification.types";
import { maskPersonalInfo } from "./notification.utils";

export type DeliverySyncResult = Record<
  Exclude<NotificationDeliveryStatus, "pending">,
  number
> & {
  // 아직 결과가 없거나 조회에 실패해서 다음에 다시 조회할 로그 수
  pending: number;
};

// 알리고 접수(sent) 뒤 카카오 단계 최종 결과를 가져와 notification_log에 남김
// (NotificationDeliverySyncScheduler가 매분 호출, CRB-77).
// 카카오 단계 실패는 템플릿 불일치처럼 다시 보내도 해결되지 않는 경우가 많아 재발송하지 않고 Slack으로 알림
@Injectable()
export class NotificationDeliverySyncService {
  private readonly logger = new Logger(NotificationDeliverySyncService.name);

  constructor(
    private readonly notificationLogRepository: NotificationLogRepository,
    private readonly alimtalkService: AlimtalkService,
    private readonly slackService: SlackService,
  ) {}

  // 로그마다 따로 처리해서 하나가 실패해도 나머지는 진행. 잡아 둔 행은 lease가 끝나면 다음 실행에서 다시 잡힘
  async syncDue(now: Date = new Date()): Promise<DeliverySyncResult> {
    const result: DeliverySyncResult = {
      delivered: 0,
      failed: 0,
      unknown: 0,
      pending: 0,
    };
    const leaseUntil = new Date(
      now.getTime() + ALIMTALK_DELIVERY_CLAIM_LEASE_MS,
    );

    for (;;) {
      // 잡은 행은 delivery_next_check_at이 leaseUntil로 미뤄지므로 같은 실행에서 다시 잡히지 않음
      const rows = await this.notificationLogRepository.claimDeliveryCheckDue(
        now,
        leaseUntil,
        ALIMTALK_DELIVERY_BATCH_SIZE,
      );
      if (rows.length === 0) break;

      for (const row of rows) {
        try {
          result[await this.sync(row, now)]++;
        } catch (e) {
          this.logger.error(
            `Failed to sync alimtalk delivery for notification_log ${row.pk}: ${(e as Error).message}`,
          );
        }
      }
    }
    return result;
  }

  private async sync(
    row: DeliveryCheckRow,
    now: Date,
  ): Promise<NotificationDeliveryStatus> {
    const delivery = await this.alimtalkService.fetchResult(
      row.providerMessageId,
    );
    const target = `alimtalk (event: ${row.event}, coffee_chat_request: ${row.coffeeChatRequestPk}, attempt: ${row.attempt}, mid: ${row.providerMessageId})`;

    if (delivery.status === "delivered" || delivery.status === "failed") {
      await this.notificationLogRepository.updateDelivery(row.pk, {
        deliveryStatus: delivery.status,
        deliveryCode: delivery.code,
        deliveryMessage: delivery.message,
        deliveryReportedAt: delivery.reportedAt,
        deliveryNextCheckAt: null,
      });
      if (delivery.status === "failed") {
        // 실패 사유에 전화번호가 섞여 있을 수 있음. DB에는 원문을 두고 어드민 응답 · Slack에서 가림
        const reason = this.mask(delivery.message ?? "", row);
        this.alert(
          `Alimtalk was not delivered: ${target}: ${delivery.code} ${reason}`.trim(),
          "ALIMTALK DELIVERY FAILED",
        );
      }
      return delivery.status;
    }

    if (delivery.status === "error") {
      this.logger.warn(
        `Failed to fetch alimtalk delivery result for ${target}: ${delivery.error}`,
      );
    }

    const age = now.getTime() - row.createdAt.getTime();
    if (age >= ALIMTALK_DELIVERY_GIVE_UP_AFTER_MS) {
      // 알리고가 24시간 동안 시도한 뒤에도 결과가 없음. 도달 여부를 알 수 없으므로 운영자가 콘솔에서 확인
      await this.notificationLogRepository.updateDelivery(row.pk, {
        deliveryStatus: "unknown",
        deliveryMessage: delivery.status === "error" ? delivery.error : null,
        deliveryNextCheckAt: null,
      });
      this.alert(
        `Gave up fetching alimtalk delivery result: ${target}${delivery.status === "error" ? `: ${this.mask(delivery.error, row)}` : ""}`,
        "ALIMTALK DELIVERY UNKNOWN",
      );
      return "unknown";
    }

    const interval =
      age < ALIMTALK_DELIVERY_SHORT_CHECK_PERIOD_MS
        ? ALIMTALK_DELIVERY_SHORT_CHECK_INTERVAL_MS
        : ALIMTALK_DELIVERY_LONG_CHECK_INTERVAL_MS;
    await this.notificationLogRepository.updateDelivery(row.pk, {
      deliveryNextCheckAt: new Date(now.getTime() + interval),
    });
    return "pending";
  }

  private mask(text: string, row: DeliveryCheckRow): string {
    return maskPersonalInfo(text, row.recipient);
  }

  private alert(message: string, title: string): void {
    this.logger.error(message);
    this.slackService
      .sendText(`*[${title}]*\n${message}`, { channel: "bug" })
      .catch((err) => {
        this.logger.error("Failed to send Slack notification", err);
      });
  }
}
