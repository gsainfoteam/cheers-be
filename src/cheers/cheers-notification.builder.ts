import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { StudentContact } from "@src/database/repository/coffee-chat-request.repository";
import { buildCoffeeChatRequestedMail } from "@src/mail/templates/coffee-chat-requested.template";
import { buildContactSharedMail } from "@src/mail/templates/contact-shared.template";
import { NotifyInput } from "@src/notification/notification.types";
import {
  GRADUATED_FALLBACK_NAME,
  STUDENT_FALLBACK_NAME,
} from "./cheers.constants";
import { resolveWebBaseUrl } from "./cheers.utils";

// 알림을 받는 사람 (연락 설정이 없으면 contact = null)
export type NotificationRecipient = {
  name: string | null;
  contact: StudentContact | null;
};

// 커피챗 알림 입력을 만듦. 받는 사람이 연락 설정에서 켠 채널만 담음.
// 요청 · 연락처 공유 API와 재시도 스케줄러가 같이 씀 (CRB-75)
@Injectable()
export class CheersNotificationBuilder {
  private readonly logger = new Logger(CheersNotificationBuilder.name);
  // 알림 메일의 요청 상세 링크 (끝의 / 제거). 로컬에서 비어 있으면 링크 없이 발송
  private readonly webBaseUrl: string | null;

  constructor(configService: ConfigService) {
    this.webBaseUrl = resolveWebBaseUrl(configService, this.logger);
  }

  // 재학생 → 현업자 커피챗 요청. 받는 사람은 현업자
  requested(
    coffeeChatRequestPk: string,
    recipient: NotificationRecipient,
  ): NotifyInput<"coffee_chat_requested"> {
    const contact = recipient.contact;
    const name = recipient.name ?? GRADUATED_FALLBACK_NAME;
    const link = this.webBaseUrl
      ? `${this.webBaseUrl}/applications/${coffeeChatRequestPk}`
      : null;

    return {
      coffeeChatRequestPk,
      event: "coffee_chat_requested",
      email:
        contact?.emailEnabled && contact.email
          ? buildCoffeeChatRequestedMail(contact.email, name, link)
          : undefined,
      alimtalk:
        contact?.kakaoEnabled && contact.phone
          ? {
              to: contact.phone,
              variables: { recipientName: name, coffeeChatRequestPk },
            }
          : undefined,
    };
  }

  // 현업자의 연락처 공유. 받는 사람은 재학생
  contactShared(
    coffeeChatRequestPk: string,
    recipient: NotificationRecipient,
    graduatedName: string | null,
  ): NotifyInput<"contact_shared"> {
    const contact = recipient.contact;
    const recipientName = recipient.name ?? STUDENT_FALLBACK_NAME;
    const senderName = graduatedName ?? GRADUATED_FALLBACK_NAME;
    const link = this.webBaseUrl
      ? `${this.webBaseUrl}/applications/${coffeeChatRequestPk}`
      : null;

    return {
      coffeeChatRequestPk,
      event: "contact_shared",
      email:
        contact?.emailEnabled && contact.email
          ? buildContactSharedMail(
              contact.email,
              recipientName,
              senderName,
              link,
            )
          : undefined,
      alimtalk:
        contact?.kakaoEnabled && contact.phone
          ? {
              to: contact.phone,
              variables: {
                recipientName,
                graduatedName: senderName,
                coffeeChatRequestPk,
              },
            }
          : undefined,
    };
  }
}
