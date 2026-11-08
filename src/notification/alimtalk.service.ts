import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AlimtalkDeliveryResult,
  AlimtalkResult,
  SendAlimtalkInput,
} from "./alimtalk.types";
import { NotificationEvent } from "./notification.types";
import { maskRecipient } from "./notification.utils";

const ALIGO_SEND_URL = "https://kakaoapi.aligo.in/akv10/alimtalk/send/";
const ALIGO_HISTORY_DETAIL_URL =
  "https://kakaoapi.aligo.in/akv10/history/detail/";

// 전송결과의 rslt가 이 값이면 카카오톡으로 도달한 것
// 알리고 문서에는 성공 값이 적혀 있지 않음. 실패 예시는 "U" (메시지가 템플릿과 일치하지않음)
const ALIGO_DELIVERED_RSLT = "0";

interface AlimtalkTemplate {
  // 강조표기형 타이틀 (emtitle_1). 관리용 제목(subject_1)에도 같은 값을 씀
  title: string;
  message: string;
  buttonName: string;
  // WEB_BASE_URL 뒤에 붙는 버튼 링크 경로. cheers-fe의 신청 상세(/applications/{id})는 학생 · 현업자 공용
  path: (coffeeChatRequestPk: string) => string;
}

// title, message, 버튼은 알리고에 등록한 템플릿과 글자 하나까지 같아야 함 (다르면 전송되지 않음)
// 버튼 링크는 템플릿에 https://#{cheers_url}로 등록되어 있어서 WEB_BASE_URL은 https://로 시작해야 함
const TEMPLATES: Record<NotificationEvent, AlimtalkTemplate> = {
  coffee_chat_requested: {
    title: "☕️ 커피챗 요청 안내",
    message:
      "재학생 회원으로부터 새로운 커피챗 요청이 도착했어요\n" +
      "요청 내용을 확인하고 커피챗 가능 여부를 알려주세요 :)",
    buttonName: "Cheers에서 확인하기",
    path: (pk) => `/applications/${encodeURIComponent(pk)}`,
  },
  contact_shared: {
    title: "☕️ 연락처 공유 안내",
    message:
      "회원님의 커피챗 요청에 대해 선배가 연락처를 공유했어요\n" +
      "연락처를 확인하고 커피챗 일정을 잡아볼까요?",
    buttonName: "Cheers에서 확인하기",
    path: (pk) => `/applications/${encodeURIComponent(pk)}`,
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

// POST /akv10/history/detail/ 응답. 숫자도 문자열로 오는 경우가 있음
interface AligoHistoryDetailResponse {
  code?: number | string;
  message?: string;
  list?: {
    // 전송 중이면 "Q"로 시작
    msgid?: string;
    rslt?: string | number;
    rslt_message?: string;
    // YYYY-MM-DD HH:ii:ss (KST)
    rsltdate?: string;
  }[];
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// 알리고 시각은 KST. 비어 있거나 형식이 다르면 null
function parseAligoDate(value: string | undefined): Date | null {
  const match = value
    ?.trim()
    .match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (!match) return null;
  const date = new Date(`${match[1]}T${match[2]}+09:00`);
  return Number.isNaN(date.getTime()) ? null : date;
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

    if (!webBaseUrl.startsWith("https://")) {
      // 버튼 링크가 템플릿의 https://#{cheers_url}과 맞지 않아 전송되지 않음
      this.logger.warn(
        "WEB_BASE_URL must start with https:// for alimtalk buttons. Alimtalk will be logged instead of sent.",
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
    const link = `${this.config.webBaseUrl}${template.path(input.variables.coffeeChatRequestPk)}`;

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
          subject_1: template.title,
          emtitle_1: template.title,
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
      const body = parseJson<AligoSendResponse>(await response.text());

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

  /**
   * 접수된 알림톡(mid)의 카카오 단계 결과를 알리고 전송결과 조회로 가져옵니다. throw하지 않습니다.
   * 수신자가 1명이라 목록의 첫 건만 봅니다. 최종 결과는 접수 후 최대 24시간 뒤에 나옵니다.
   */
  async fetchResult(mid: string): Promise<AlimtalkDeliveryResult> {
    if (!this.config) {
      return { status: "error", error: "alimtalk is not configured" };
    }

    try {
      const response = await fetch(ALIGO_HISTORY_DETAIL_URL, {
        method: "POST",
        body: new URLSearchParams({
          apikey: this.config.apiKey,
          userid: this.config.userId,
          mid,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      const body = parseJson<AligoHistoryDetailResponse>(await response.text());

      if (!response.ok) {
        return {
          status: "error",
          error:
            `${response.status} ${body?.code ?? ""} ${body?.message ?? ""}`.trim(),
        };
      }

      if (!body) {
        return {
          status: "error",
          error: `${response.status} invalid response body`,
        };
      }

      // 조회 실패도 HTTP 200으로 옴 (예: -101 인증오류입니다.)
      if (Number(body.code) !== 0) {
        return {
          status: "error",
          error: `${body.code ?? ""} ${body.message ?? ""}`.trim(),
        };
      }

      // 목록에 없거나 msgid가 Q로 시작하거나 rslt가 비어 있으면 아직 전송 중
      const item = body.list?.[0];
      const code = String(item?.rslt ?? "").trim();
      if (!item || item.msgid?.startsWith("Q") || code === "") {
        return { status: "pending" };
      }

      return {
        status: code === ALIGO_DELIVERED_RSLT ? "delivered" : "failed",
        code,
        message: item.rslt_message?.trim() || null,
        reportedAt: parseAligoDate(item.rsltdate),
      };
    } catch (error) {
      return {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
