import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { isEmail } from "class-validator";
import { SlackService } from "nestjs-slack";
import { createTransport, Transporter } from "nodemailer";
import { MailResult, SendMailInput } from "./mail.types";
import { CHEERS_LOGO_CID, CHEERS_LOGO_PNG_BASE64 } from "./templates/logo";

// 템플릿 html이 cid:cheers-logo를 쓰면 로고를 인라인 첨부로 붙임 (CRB-70)
const LOGO_ATTACHMENT = {
  filename: "cheers-logo.png",
  content: Buffer.from(CHEERS_LOGO_PNG_BASE64, "base64"),
  contentType: "image/png",
  cid: CHEERS_LOGO_CID,
};

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

    // 빈 값은 미설정으로 봄
    const fromAddress = this.configService
      .get<string>("MAIL_FROM_ADDRESS")
      ?.trim();
    if (fromAddress && !isEmail(fromAddress)) {
      throw new Error("MAIL_FROM_ADDRESS must be a valid email address.");
    }

    this.from = `"${fromName}" <${fromAddress || user}>`;

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

    // nodemailer 기본값(연결 2분, 유휴 소켓 10분)은 인증번호 발송에 너무 길어서 명시.
    // 인증번호 메일은 응답 전에 기다리므로 연결을 재사용해 매번 TLS · 로그인을 하지 않게 함 (CRB-75)
    this.transporter = createTransport({
      service: "gmail",
      pool: true,
      auth: { user, pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
  }

  /**
   * 메일을 발송하고 결과를 반환합니다. 실패해도 throw하지 않습니다.
   */
  async send(input: SendMailInput): Promise<MailResult> {
    if (!this.transporter) {
      this.logger.log(`[MAIL SKIPPED] to=${input.to} subject=${input.subject}`);
      return { success: true, skipped: true };
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.html.includes(`cid:${CHEERS_LOGO_CID}`)
          ? { attachments: [LOGO_ATTACHMENT] }
          : {}),
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
   * 메일을 발송하고 결과를 반환합니다. 실패하면 로그와 Slack 알림을 남깁니다. throw하지 않습니다.
   */
  async sendAndAlert(input: SendMailInput): Promise<MailResult> {
    const result = await this.send(input);
    if (result.success) return result;

    const message = `Failed to send mail to ${input.to} (subject: ${input.subject}): ${result.error}`;
    this.logger.error(message);
    this.slackService
      .sendText(`*[MAIL ERROR]*\n${message}`, { channel: "bug" })
      .catch((err) => {
        this.logger.error("Failed to send Slack notification", err);
      });
    return result;
  }
}
