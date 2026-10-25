import { Injectable, Logger } from "@nestjs/common";
import { SlackService } from "nestjs-slack";
import { MailService } from "@src/mail/mail.service";
import { MailResult } from "@src/mail/mail.types";
import { AlimtalkService } from "./alimtalk.service";
import { AlimtalkResult } from "./alimtalk.types";
import { NotificationLogRepository } from "./notification-log.repository";
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
   */
  notifyAsync<E extends NotificationEvent>(input: NotifyInput<E>): void {
    void this.notify(input);
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
      this.alert(
        `Failed to send ${channel} to ${recipient} (event: ${input.event}, coffee_chat_request: ${input.coffeeChatRequestPk}): ${result.error}`,
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
