import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CoffeeChatRequestRow } from "@src/database/repository/coffee-chat-request.repository";

export type CoffeeChatRequestStatus = "requested" | "viewed" | "contact_shared";

// 진행 단계는 처음 일어난 시각 컬럼으로 계산 (가장 뒤 단계부터)
export function toRequestStatus(
  row: Pick<CoffeeChatRequestRow, "graduatedViewedAt" | "contactSharedAt">,
): CoffeeChatRequestStatus {
  if (row.contactSharedAt) return "contact_shared";
  if (row.graduatedViewedAt) return "viewed";
  return "requested";
}

// 현업자 목록 random 정렬의 seed: intervalMinutes 구간 번호. 같은 구간 안에서는 같은 값
export function randomSeed(now: Date, intervalMinutes: number): string {
  return String(Math.floor(now.getTime() / (intervalMinutes * 60_000)));
}

export function toOffset(page: number, size: number): number {
  return (page - 1) * size;
}

// 알림 메일의 요청 상세 링크 기준 주소 (끝의 / 제거). 로컬에서 비어 있으면 null이고 링크 없이 발송
export function resolveWebBaseUrl(
  configService: ConfigService,
  logger: Logger,
): string | null {
  const webBaseUrl = configService
    .get<string>("WEB_BASE_URL")
    ?.trim()
    .replace(/\/+$/, "");
  if (webBaseUrl) return webBaseUrl;

  // 배포 환경에서는 링크 없는 알림 메일이 나가지 않게 막음
  if (configService.get<string>("NODE_ENV") === "production") {
    throw new Error("WEB_BASE_URL is required in production.");
  }
  logger.warn(
    "WEB_BASE_URL is not set. Coffee chat mails will be sent without a link.",
  );
  return null;
}
