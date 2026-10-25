import { Injectable, Logger } from "@nestjs/common";
import { SlackService } from "nestjs-slack";
import { MailService } from "@src/mail/mail.service";
import { MailResult } from "@src/mail/mail.types";
import { AlimtalkService } from "./alimtalk.service";
import { AlimtalkResult } from "./alimtalk.types";
import { NotificationLogRepository } from "./notification-log.repository";
import { maskRecipient } from "./notification.utils";
import {
  NotificationChannel,
  NotificationEvent,
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
   *
   * 주의: 로그는 트랜잭션 밖 connection에서 insert되고 coffee_chat_request에 FK가 있으므로,
   * 요청을 만든 트랜잭션이 commit된 뒤에 호출해야 합니다. 트랜잭션 안에서 부르면 발송은 되지만 로그 insert가 FK 위반으로 실패합니다.
   */
  async notify<E extends NotificationEvent>(
    input: NotifyInput<E>,
  ): Promise<void> {
    const tasks: Promise<void>[] = [];

    if (input.email) {
      const email = input.email;
      tasks.push(
        this.mailService
          .send(email)
          .then((result) => this.record(input, "email", email.to, result)),
      );
    }

    if (input.alimtalk) {
      const { to, variables } = input.alimtalk;
      tasks.push(
        this.alimtalkService
          .send({ event: input.event, to, variables })
          .then((result) => this.record(input, "kakao_alimtalk", to, result)),
      );
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

  private async record(
    input: NotifyInput,
    channel: NotificationChannel,
    recipient: string,
    result: MailResult | AlimtalkResult,
  ): Promise<void> {
    // 실제로 나가지 않은 발송(로컬 · 키 미설정)은 기록하지 않음
    if (result.skipped) return;

    if (!result.success) {
      // 수신자는 마스킹해서 남김 (발송사 에러 문구에 원문이 섞여 있을 수 있음)
      const masked = maskRecipient(recipient);
      const error = result.error?.replaceAll(recipient, masked);
      this.alert(
        `Failed to send ${channel} to ${masked} (event: ${input.event}, coffee_chat_request: ${input.coffeeChatRequestPk}): ${error}`,
      );
    }

    try {
      await this.notificationLogRepository.insert({
        coffeeChatRequestPk: input.coffeeChatRequestPk,
        event: input.event,
        channel,
        status: result.success ? "sent" : "failed",
        recipient,
        providerMessageId: result.messageId,
        error: result.error,
      });
    } catch (error) {
      this.alert(
        `Failed to write notification_log (${channel}, event: ${input.event}, coffee_chat_request: ${input.coffeeChatRequestPk}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private alert(message: string): void {
    this.logger.error(message);
    this.slackService
      .sendText(`*[NOTIFICATION ERROR]*\n${message}`, { channel: "bug" })
      .catch((err) => {
        this.logger.error("Failed to send Slack notification", err);
      });
  }
}
