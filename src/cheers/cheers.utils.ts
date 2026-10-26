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
