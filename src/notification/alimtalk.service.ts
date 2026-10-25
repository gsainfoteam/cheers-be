import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, randomBytes } from "node:crypto";
import {
  AlimtalkResult,
  AlimtalkVariablesMap,
  SendAlimtalkInput,
} from "./alimtalk.types";
import { NotificationEvent } from "./notification.types";
import { maskRecipient } from "./notification.utils";

const SOLAPI_SEND_URL = "https://api.solapi.com/messages/v4/send-many/detail";

// 키는 솔라피에 등록한 템플릿의 치환 문구와 정확히 같아야 함
const TEMPLATE_VARIABLES: {
  [E in NotificationEvent]: (
    variables: AlimtalkVariablesMap[E],
  ) => Record<string, string>;
} = {
  coffee_chat_requested: (v) => ({
    "#{이름}": v.recipientName,
    "#{요청ID}": v.coffeeChatRequestPk,
  }),
  contact_shared: (v) => ({
    "#{이름}": v.recipientName,
    "#{현업자이름}": v.graduatedName,
    "#{요청ID}": v.coffeeChatRequestPk,
  }),
};

interface SolapiConfig {
  apiKey: string;
  apiSecret: string;
  sender: string;
  pfId: string;
  templateIds: Record<NotificationEvent, string>;
}

interface SolapiMessageResult {
  messageId?: string;
  statusCode?: string;
  statusMessage?: string;
}

interface SolapiSendResponse {
  failedMessageList?: SolapiMessageResult[];
  messageList?: SolapiMessageResult[];
  errorCode?: string;
  errorMessage?: string;
}

function parseJson(text: string): SolapiSendResponse | null {
  try {
    return JSON.parse(text) as SolapiSendResponse;
  } catch {
    return null;
  }
}

@Injectable()
export class AlimtalkService {
  private readonly logger = new Logger(AlimtalkService.name);
  private readonly config: SolapiConfig | null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("SOLAPI_API_KEY");
    const apiSecret = this.configService.get<string>("SOLAPI_API_SECRET");
    const sender = this.configService.get<string>("SOLAPI_SENDER_PHONE");
    const pfId = this.configService.get<string>("KAKAO_PF_ID");
    const coffeeChatRequested = this.configService.get<string>(
      "KAKAO_TEMPLATE_COFFEE_CHAT_REQUESTED",
    );
    const contactShared = this.configService.get<string>(
      "KAKAO_TEMPLATE_CONTACT_SHARED",
    );

    if (
      !apiKey ||
      !apiSecret ||
      !sender ||
      !pfId ||
      !coffeeChatRequested ||
      !contactShared
    ) {
      // 비즈 채널 · 템플릿 심사 전에도 배포할 수 있게 production에서도 막지 않음
      this.logger.warn(
        "Solapi or Kakao alimtalk config is not set. Alimtalk will be logged instead of sent.",
      );
      this.config = null;
      return;
    }

    this.config = {
      apiKey,
      apiSecret,
      sender,
      pfId,
      templateIds: {
        coffee_chat_requested: coffeeChatRequested,
        contact_shared: contactShared,
      },
    };
  }

  /**
   * 알림톡을 발송하고 결과를 반환합니다. 실패해도 throw하지 않습니다.
   * success는 솔라피 접수 성공이며, 실제 도달 여부는 아닙니다.
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

    const buildVariables = TEMPLATE_VARIABLES[input.event] as (
      variables: AlimtalkVariablesMap[E],
    ) => Record<string, string>;

    try {
      const response = await fetch(SOLAPI_SEND_URL, {
        method: "POST",
        headers: {
          Authorization: this.createAuthorization(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              to: input.to,
              from: this.config.sender,
              type: "ATA",
              kakaoOptions: {
                pfId: this.config.pfId,
                templateId: this.config.templateIds[input.event],
                variables: buildVariables(input.variables),
                // 알림톡 실패 시 문자로 대체 발송하지 않음
                disableSms: true,
              },
            },
          ],
          showMessageList: true,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      // 게이트웨이가 HTML 에러 페이지를 줄 수 있어서 상태 코드를 먼저 보고 JSON은 실패해도 진행
      const body = parseJson(await response.text());

      if (!response.ok) {
        return {
          success: false,
          error:
            `${response.status} ${body?.errorCode ?? ""} ${body?.errorMessage ?? ""}`.trim(),
        };
      }

      if (!body) {
        return {
          success: false,
          error: `${response.status} invalid response body`,
        };
      }

      const failed = body.failedMessageList?.[0];
      if (failed) {
        return {
          success: false,
          messageId: failed.messageId,
          error: `${failed.statusCode} ${failed.statusMessage}`,
        };
      }

      return { success: true, messageId: body.messageList?.[0]?.messageId };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // https://solapi.com/developers/api/authentication-api-key
  private createAuthorization(): string {
    const { apiKey, apiSecret } = this.config!;
    const date = new Date().toISOString();
    const salt = randomBytes(32).toString("hex");
    const signature = createHmac("sha256", apiSecret)
      .update(date + salt)
      .digest("hex");
    return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
  }
}
