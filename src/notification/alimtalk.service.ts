import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AlimtalkResult, SendAlimtalkInput } from "./alimtalk.types";
import { NotificationEvent } from "./notification.types";
import { maskRecipient } from "./notification.utils";

const ALIGO_SEND_URL = "https://kakaoapi.aligo.in/akv10/alimtalk/send/";

interface AlimtalkTemplate {
  subject: string;
  message: string;
  buttonName: string;
  // WEB_BASE_URL 뒤에 붙는 버튼 링크 경로
  path: string;
}

// message와 버튼은 알리고에 등록한 템플릿과 글자 하나까지 같아야 함 (다르면 전송되지 않음)
const TEMPLATES: Record<NotificationEvent, AlimtalkTemplate> = {
  coffee_chat_requested: {
    subject: "커피챗 요청 도착",
    message:
      "Cheers\n\n☕ 새로운 커피챗 요청이 도착했어요\n요청자로부터 온 메시지를 확인하고 커피챗 가능 여부를 알려주세요",
    buttonName: "커피챗 요청 확인하기",
    path: "/cheers/received",
  },
  contact_shared: {
    subject: "연락처 공유 도착",
    message:
      "Cheers\n\n☕ 선배가 연락처를 공유했어요\n연락처를 확인하고 커피챗 일정을 잡아볼까요?",
    buttonName: "연락처 확인하기",
    path: "/cheers/sent",
  },
};

interface AligoConfig {
  apiKey: string;
  userId: string;
  senderKey: string;
  sender: string;
  webBaseUrl: string;
  templateCodes: Record<NotificationEvent, string>;
}

interface AligoSendResponse {
  code?: number | string;
  message?: string;
  info?: {
    // 문서의 표는 Integer, 예시는 문자열
    mid?: number | string;
    // 잘못 요청된 연락처 수
    fcnt?: number | string;
  };
}

function parseJson(text: string): AligoSendResponse | null {
  try {
    return JSON.parse(text) as AligoSendResponse;
  } catch {
    return null;
  }
}

@Injectable()
export class AlimtalkService {
  private readonly logger = new Logger(AlimtalkService.name);
  private readonly config: AligoConfig | null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("ALIGO_API_KEY");
    const userId = this.configService.get<string>("ALIGO_USER_ID");
    const senderKey = this.configService.get<string>("ALIGO_SENDER_KEY");
    const sender = this.configService.get<string>("ALIGO_SENDER_PHONE");
    const webBaseUrl = this.configService
      .get<string>("WEB_BASE_URL")
      ?.trim()
      .replace(/\/+$/, "");
    const coffeeChatRequested = this.configService.get<string>(
      "KAKAO_TEMPLATE_COFFEE_CHAT_REQUESTED",
    );
    const contactShared = this.configService.get<string>(
      "KAKAO_TEMPLATE_CONTACT_SHARED",
    );

    if (
      !apiKey ||
      !userId ||
      !senderKey ||
      !sender ||
      !webBaseUrl ||
      !coffeeChatRequested ||
      !contactShared
    ) {
      // 비즈 채널 · 템플릿 심사 전에도 배포할 수 있게 production에서도 막지 않음
      this.logger.warn(
        "Aligo or Kakao alimtalk config is not set. Alimtalk will be logged instead of sent.",
      );
      this.config = null;
      return;
    }

    this.config = {
      apiKey,
      userId,
      senderKey,
      sender,
      webBaseUrl,
      templateCodes: {
        coffee_chat_requested: coffeeChatRequested,
        contact_shared: contactShared,
      },
    };
  }

  /**
   * 알림톡을 발송하고 결과를 반환합니다. 실패해도 throw하지 않습니다.
   * success는 알리고 접수 성공이며, 실제 도달 여부는 아닙니다.
   */
  async send<E extends NotificationEvent>(
    input: SendAlimtalkInput<E>,
  ): Promise<AlimtalkResult> {
    if (!this.config) {
      this.logger.log(
        `[ALIMTALK SKIPPED] to=${maskRecipient(input.to)} event=${input.event}`,
      );
      return { success: true, skipped: true };
    }

    const template = TEMPLATES[input.event];
    const link = `${this.config.webBaseUrl}${template.path}`;

    try {
      const response = await fetch(ALIGO_SEND_URL, {
        method: "POST",
        body: new URLSearchParams({
          apikey: this.config.apiKey,
          userid: this.config.userId,
          senderkey: this.config.senderKey,
          tpl_code: this.config.templateCodes[input.event],
          sender: this.config.sender,
          receiver_1: input.to,
          recvname_1: input.variables.recipientName,
          subject_1: template.subject,
          message_1: template.message,
          button_1: JSON.stringify({
            button: [
              {
                name: template.buttonName,
                linkType: "WL",
                linkTypeName: "웹링크",
                linkMo: link,
                linkPc: link,
              },
            ],
          }),
          // 알림톡 실패 시 문자로 대체 발송하지 않음
          failover: "N",
        }),
        signal: AbortSignal.timeout(10_000),
      });

      // 게이트웨이가 HTML 에러 페이지를 줄 수 있어서 상태 코드를 먼저 보고 JSON은 실패해도 진행
      const body = parseJson(await response.text());

      if (!response.ok) {
        return {
          success: false,
          error:
            `${response.status} ${body?.code ?? ""} ${body?.message ?? ""}`.trim(),
        };
      }

      if (!body) {
        return {
          success: false,
          error: `${response.status} invalid response body`,
        };
      }

      // 알리고는 실패도 HTTP 200으로 주고 code로 구분함
      if (Number(body.code) !== 0) {
        return {
          success: false,
          error: `${body.code ?? ""} ${body.message ?? ""}`.trim(),
        };
      }

      const messageId =
        body.info?.mid === undefined ? undefined : String(body.info.mid);

      // 수신자가 1명이라 잘못 요청된 연락처가 있으면 발송되지 않은 것
      if (Number(body.info?.fcnt) > 0) {
        return {
          success: false,
          messageId,
          error: `${body.code} invalid receiver: ${body.message ?? ""}`.trim(),
        };
      }

      return { success: true, messageId };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
