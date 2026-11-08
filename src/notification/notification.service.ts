import { Injectable, Logger } from "@nestjs/common";
import { SlackService } from "nestjs-slack";
import { TxType } from "@src/global/types/tx.types";
import { MailService } from "@src/mail/mail.service";
import { MailResult } from "@src/mail/mail.types";
import { AlimtalkService } from "./alimtalk.service";
import { AlimtalkResult } from "./alimtalk.types";
import {
  NotificationLogRepository,
  NotificationLogRow,
} from "./notification-log.repository";
import {
  ALIMTALK_DELIVERY_FIRST_CHECK_DELAY_MS,
  NOTIFICATION_RETRY_DELAYS_MS,
} from "./notification.constants";
import { maskRecipient } from "./notification.utils";
import {
  NotificationChannel,
  NotificationEvent,
  NotificationOutcome,
  NotifyInput,
} from "./notification.types";

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly mailService: MailService,
    private readonly alimtalkService: AlimtalkService,
    private readonly notificationLogRepository: NotificationLogRepository,
    private readonly slackService: SlackService,
  ) {}

  /**
   * 넘겨받은 채널마다 발송하고 결과를 notification_log에 남깁니다.
   * 채널끼리 독립적이며, 한 채널이 실패해도 다른 채널은 발송합니다. throw하지 않습니다.
   * 실패한 채널은 next_retry_at을 남겨 재시도 스케줄러가 다시 보냅니다 (CRB-75).
   *
   * 주의: 로그는 트랜잭션 밖 connection에서 insert되고 coffee_chat_request에 FK가 있으므로,
   * 요청을 만든 트랜잭션이 commit된 뒤에 호출해야 합니다. 트랜잭션 안에서 부르면 발송은 되지만 로그 insert가 FK 위반으로 실패합니다.
   */
  async notify<E extends NotificationEvent>(
    input: NotifyInput<E>,
  ): Promise<void> {
    const tasks: Promise<NotificationOutcome>[] = [];

    if (input.email) {
      tasks.push(this.sendChannel(input, "email", 1));
    }
    if (input.alimtalk) {
      tasks.push(this.sendChannel(input, "kakao_alimtalk", 1));
    }

    await Promise.all(tasks);
  }

  /**
   * 발송 결과를 기다리지 않고 바로 반환합니다.
   *
   * 주의: 요청을 만든 트랜잭션이 commit된 뒤에 호출해야 합니다 (notify 참고).
   */
  notifyAsync<E extends NotificationEvent>(input: NotifyInput<E>): void {
    this.notify(input).catch((error) => {
      this.logger.error(
        `Unexpected error while notifying (event: ${input.event}, coffee_chat_request: ${input.coffeeChatRequestPk})`,
        error,
      );
    });
  }

  /**
   * 실패한 로그의 채널 하나만 다시 보내고 새 행으로 남깁니다 (attempt + 1).
   * input에는 그 채널의 발송 정보가 있어야 합니다. 로그는 tx로 insert합니다.
   */
  async resend(
    log: NotificationLogRow,
    input: NotifyInput,
    tx: TxType,
  ): Promise<NotificationOutcome> {
    return this.sendChannel(input, log.channel, log.attempt + 1, tx);
  }

  private async sendChannel(
    input: NotifyInput,
    channel: NotificationChannel,
    attempt: number,
    tx?: TxType,
  ): Promise<NotificationOutcome> {
    if (channel === "email") {
      if (!input.email) throw new Error("Missing email input");
      const email = input.email;
      const result = await this.mailService.send(email);
      return this.record(input, channel, email.to, result, attempt, tx);
    }

    if (!input.alimtalk) throw new Error("Missing alimtalk input");
    const { to, variables } = input.alimtalk;
    const result = await this.alimtalkService.send({
      event: input.event,
      to,
      variables,
    });
    return this.record(input, channel, to, result, attempt, tx);
  }

  private async record(
    input: NotifyInput,
    channel: NotificationChannel,
    recipient: string,
    result: MailResult | AlimtalkResult,
    attempt: number,
    tx?: TxType,
  ): Promise<NotificationOutcome> {
    // 실제로 나가지 않은 발송(로컬 · 키 미설정)은 기록하지 않음
    if (result.skipped) return "skipped";

    const target = `${channel} (event: ${input.event}, coffee_chat_request: ${input.coffeeChatRequestPk}, attempt: ${attempt})`;
    let outcome: NotificationOutcome = "sent";
    let nextRetryAt: Date | null = null;
    // 수신자는 마스킹해서 남김 (발송사 에러 문구에 원문이 섞여 있을 수 있음)
    const masked = maskRecipient(recipient);
    const error = result.error?.replaceAll(recipient, masked);

    if (!result.success) {
      const delay = NOTIFICATION_RETRY_DELAYS_MS[attempt - 1];
      if (delay === undefined) {
        // 마지막 재시도까지 실패. 운영자가 직접 확인하도록 Slack으로 알림
        outcome = "gave_up";
        this.alert(
          `Gave up sending ${target} to ${masked}: ${error}`,
          "NOTIFICATION GAVE UP",
        );
      } else {
        outcome = "failed";
        nextRetryAt = new Date(Date.now() + delay);
        this.logger.warn(
          `Failed to send ${target} to ${masked}, retrying at ${nextRetryAt.toISOString()}: ${error}`,
        );
      }
    }

    // 알리고 접수 성공은 도달이 아니므로 결과 동기화 스케줄러가 카카오 최종 결과를 가져오게 함 (CRB-77)
    const awaitsDelivery =
      channel === "kakao_alimtalk" && result.success && !!result.messageId;

    try {
      await this.notificationLogRepository.insert(
        {
          coffeeChatRequestPk: input.coffeeChatRequestPk,
          event: input.event,
          channel,
          status: result.success ? "sent" : "failed",
          recipient,
          providerMessageId: result.messageId,
          error: result.error,
          attempt,
          nextRetryAt,
          ...(awaitsDelivery && {
            deliveryStatus: "pending",
            deliveryNextCheckAt: new Date(
              Date.now() + ALIMTALK_DELIVERY_FIRST_CHECK_DELAY_MS,
            ),
          }),
        },
        tx,
      );
    } catch (insertError) {
      // 로그가 없으면 재시도도 할 수 없으므로 바로 알림
      this.alert(
        `Failed to write notification_log for ${target} (${result.success ? "sent" : "failed"}): ${insertError instanceof Error ? insertError.message : String(insertError)}`,
      );
      // 재시도 중이면 트랜잭션이 깨졌으므로 그 로그의 처리를 롤백하고 다음 실행에서 다시 시도
      if (tx) throw insertError;
    }

    return outcome;
  }

  private alert(message: string, title = "NOTIFICATION ERROR"): void {
    this.logger.error(message);
    this.slackService
      .sendText(`*[${title}]*\n${message}`, { channel: "bug" })
      .catch((err) => {
        this.logger.error("Failed to send Slack notification", err);
      });
  }
}
