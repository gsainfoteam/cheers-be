import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SlackService } from "nestjs-slack";
import { createTransport, Transporter } from "nodemailer";
import { MailResult, SendMailInput } from "./mail.types";

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly slackService: SlackService,
  ) {
    const user = this.configService.get<string>("MAIL_USER");
    const pass = this.configService.get<string>("MAIL_APP_PASSWORD");
    const fromName =
      this.configService.get<string>("MAIL_FROM_NAME") ?? "취얼스";

    this.from = `"${fromName}" <${user}>`;

    if (!user || !pass) {
      // 배포 환경에서는 메일 없이 서버가 뜨지 않게 막음
      if (this.configService.get<string>("NODE_ENV") === "production") {
        throw new Error(
          "MAIL_USER and MAIL_APP_PASSWORD are required in production.",
        );
      }
      // 로컬 개발에서는 실제 발송 없이 로그만 남김
      this.logger.warn(
        "MAIL_USER or MAIL_APP_PASSWORD is not set. Mails will be logged instead of sent.",
      );
      this.transporter = null;
      return;
    }

    this.transporter = createTransport({
      service: "gmail",
      auth: { user, pass },
    });
  }

  /**
   * 메일을 발송하고 결과를 반환합니다. 실패해도 throw하지 않습니다.
   */
  async send(input: SendMailInput): Promise<MailResult> {
    if (!this.transporter) {
      this.logger.log(`[MAIL SKIPPED] to=${input.to} subject=${input.subject}`);
      return { success: true };
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });
      return { success: true, messageId: info.messageId };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 발송 결과를 기다리지 않고 바로 반환합니다. 실패 시 로그와 Slack 알림을 남깁니다.
   */
  sendAsync(input: SendMailInput): void {
    void this.send(input).then((result) => {
      if (result.success) return;

      const message = `Failed to send mail to ${input.to} (subject: ${input.subject}): ${result.error}`;
      this.logger.error(message);
      this.slackService
        .sendText(`*[MAIL ERROR]*\n${message}`, { channel: "bug" })
        .catch((err) => {
          this.logger.error("Failed to send Slack notification", err);
        });
    });
  }
}
