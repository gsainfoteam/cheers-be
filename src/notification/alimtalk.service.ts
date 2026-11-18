import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AlimtalkTemplateCache } from "./alimtalk-template.cache";
import {
  AligoBalanceResult,
  AlimtalkDeliveryResult,
  AlimtalkResult,
  SendAlimtalkInput,
} from "./alimtalk.types";
import { NotificationEvent } from "./notification.types";
import { maskRecipient } from "./notification.utils";

const ALIGO_SEND_URL = "https://kakaoapi.aligo.in/akv10/alimtalk/send/";
const ALIGO_HISTORY_DETAIL_URL =
  "https://kakaoapi.aligo.in/akv10/history/detail/";
const ALIGO_HEART_INFO_URL = "https://kakaoapi.aligo.in/akv10/heartinfo/";

// 전송결과의 rslt가 이 값이면 카카오톡으로 도달한 것
// 알리고 문서에는 성공 값이 적혀 있지 않음. 실패 예시는 "U" (메시지가 템플릿과 일치하지않음)
const ALIGO_DELIVERED_RSLT = "0";

// 템플릿 문구 · 코드 · 버튼 이름은 DB(alimtalk_template)에 있고 어드민에서 수정함 (CRB-78).
// 알리고에 등록한 템플릿과 글자 하나까지 같아야 전송됨. 버튼 링크는 템플릿에 https://#{cheers_url}로 등록되어 있어서 WEB_BASE_URL은 https://로 시작해야 함
// 버튼 링크 경로는 코드에 둠. type marker는 cheers-fe 안내 UI 선택용일 뿐 권한 판단에 쓰지 않음.
const BUTTON_PATHS: Record<NotificationEvent, (pk: string) => string> = {
  coffee_chat_requested: (pk) =>
    `/applications/${encodeURIComponent(pk)}?type=graduated`,
  contact_shared: (pk) => `/applications/${encodeURIComponent(pk)}`,
};

interface AligoConfig {
  apiKey: string;
  userId: string;
  senderKey: string;
  sender: string;
  webBaseUrl: string;
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

// POST /akv10/heartinfo/ 응답. list의 필드명은 문서에 예시가 적어 확인되지 않았음 (숫자도 문자열로 올 수 있음)
interface AligoHeartInfoResponse {
  code?: number | string;
  message?: string;
  list?: Record<string, unknown> | Record<string, unknown>[];
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
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

  constructor(
    private readonly configService: ConfigService,
    private readonly templateCache: AlimtalkTemplateCache,
  ) {
    const apiKey = this.configService.get<string>("ALIGO_API_KEY");
    const userId = this.configService.get<string>("ALIGO_USER_ID");
    const senderKey = this.configService.get<string>("ALIGO_SENDER_KEY");
    const sender = this.configService.get<string>("ALIGO_SENDER_PHONE");
    const webBaseUrl = this.configService
      .get<string>("WEB_BASE_URL")
      ?.trim()
      .replace(/\/+$/, "");

    if (!apiKey || !userId || !senderKey || !sender || !webBaseUrl) {
      // 비즈 채널 · 템플릿 심사 전에도 배포할 수 있게 production에서도 막지 않음
      this.logger.warn(
        "Aligo config is not set. Alimtalk will be logged instead of sent.",
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

    const template = await this.templateCache.get(input.event);
    if (!template) {
      return { success: false, error: "template not found" };
    }
    if (!template.tplCode) {
      // 어드민에서 템플릿 코드를 넣기 전에도 배포할 수 있게 막지 않음
      this.logger.warn(
        `Alimtalk template code is empty. Alimtalk will be logged instead of sent. event=${input.event}`,
      );
      this.logger.log(
        `[ALIMTALK SKIPPED] to=${maskRecipient(input.to)} event=${input.event}`,
      );
      return { success: true, skipped: true };
    }
    const link = `${this.config.webBaseUrl}${BUTTON_PATHS[input.event](input.variables.coffeeChatRequestPk)}`;

    try {
      const response = await fetch(ALIGO_SEND_URL, {
        method: "POST",
        body: new URLSearchParams({
          apikey: this.config.apiKey,
          userid: this.config.userId,
          senderkey: this.config.senderKey,
          tpl_code: template.tplCode,
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

  /**
   * 알리고 잔여 충전금액 · 건수를 heartinfo로 조회합니다. throw하지 않습니다 (CRB-78).
   * list의 숫자 값은 키를 소문자로 바꿔 counts에 그대로 담고, 금액은 cash · point · balance · amount로 시작하는 키에서 찾습니다.
   * 실제 응답 필드명은 문서에 없어 운영 키로 한 번 호출해 확인한 뒤 맞춰야 합니다.
   */
  async fetchBalance(): Promise<AligoBalanceResult> {
    if (!this.config) {
      return { status: "not_configured" };
    }

    try {
      const response = await fetch(ALIGO_HEART_INFO_URL, {
        method: "POST",
        body: new URLSearchParams({
          apikey: this.config.apiKey,
          userid: this.config.userId,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      const body = parseJson<AligoHeartInfoResponse>(await response.text());

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

      if (Number(body.code) !== 0) {
        return {
          status: "error",
          error: `${body.code ?? ""} ${body.message ?? ""}`.trim(),
        };
      }

      const list = Array.isArray(body.list) ? body.list[0] : body.list;
      let amount: number | null = null;
      const counts: Record<string, number> = {};
      for (const [key, value] of Object.entries(list ?? {})) {
        const parsed = toNumber(value);
        if (parsed === null) continue;
        const name = key.toLowerCase();
        if (amount === null && /^(cash|point|balance|amount)/.test(name)) {
          amount = parsed;
        } else {
          counts[name] = parsed;
        }
      }

      return { status: "ok", amount, counts };
    } catch (error) {
      return {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
