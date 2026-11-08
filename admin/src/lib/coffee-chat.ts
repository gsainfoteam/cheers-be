import { ApiError } from "./api";

export const REQUEST_BASE_PATH = "/api/manager/v1/coffee-chat/request";
export const NOTIFICATION_LOG_PATH =
  "/api/manager/v1/coffee-chat/notification-log";

export type PageResponse<T> = {
  items: T[];
  page: number;
  size: number;
  total: number;
};

export type DeliveryStatus = "pending" | "delivered" | "failed" | "unknown";

export type NotificationLog = {
  pk: string;
  event: "coffee_chat_requested" | "contact_shared";
  channel: "email" | "kakao_alimtalk";
  // 발송사 접수 결과. 알림톡의 sent는 알리고 접수 성공일 뿐이고 도달 여부는 delivery_status
  status: "sent" | "failed";
  error: string | null;
  // 알림톡은 알리고 mid
  provider_message_id: string | null;
  // 알림톡 카카오 최종 결과 (CRB-77). 이메일 · 접수 실패는 null
  delivery_status: DeliveryStatus | null;
  delivery_code: string | null;
  delivery_message: string | null;
  delivery_reported_at: string | null;
  attempt: number;
  next_retry_at: string | null;
  created_at: string;
};

export type NotificationLogItem = NotificationLog & {
  coffee_chat_request_pk: string;
};

// POST {NOTIFICATION_LOG_PATH}/:pk/delivery-lookup 응답
export type DeliveryLookup = {
  lookup: "delivered" | "failed" | "pending";
  log: NotificationLogItem;
};

export const REQUEST_STATUS_LABELS = {
  requested: "요청됨",
  viewed: "열람함",
  contact_shared: "연락처 공유함",
};

export const EVENT_LABELS: Record<NotificationLog["event"], string> = {
  coffee_chat_requested: "커피챗 요청",
  contact_shared: "연락처 공유",
};

export const CHANNEL_LABELS: Record<NotificationLog["channel"], string> = {
  email: "이메일",
  kakao_alimtalk: "알림톡",
};

// 발송사 접수 결과. 알림톡은 접수 뒤 카카오 단계에서 실패할 수 있어 DELIVERY_STATUS_LABELS를 함께 봄
export const LOG_STATUS_LABELS: Record<NotificationLog["status"], string> = {
  sent: "발송 성공",
  failed: "발송 실패",
};

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: "결과 대기",
  delivered: "도달",
  failed: "카카오 실패",
  unknown: "결과 확인 불가",
};

// 표에 보여 줄 결과. 알림톡은 알리고 접수만으로는 성공이 아니므로 카카오 결과를 보여 줌
export function logResultLabel(log: NotificationLog): string {
  if (log.status === "failed") return LOG_STATUS_LABELS.failed;
  if (log.channel === "email") return LOG_STATUS_LABELS.sent;
  return log.delivery_status
    ? `알리고 접수 · ${DELIVERY_STATUS_LABELS[log.delivery_status]}`
    : "알리고 접수";
}

// 알리고에 바로 조회할 수 있는 로그 (접수된 알림톡 중 도달이 확인되지 않은 것)
export function canLookupDelivery(log: NotificationLog): boolean {
  return (
    log.channel === "kakao_alimtalk" &&
    log.status === "sent" &&
    !!log.provider_message_id &&
    log.delivery_status !== "delivered"
  );
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export function formatDateTime(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// 날짜 입력값(브라우저 시간대)을 API의 [created_from, created_to) 시각으로 바꿈. 끝 날짜도 그날 전체를 포함
// URL을 직접 고친 값은 그대로 보내 서버의 400 메시지를 보여 줌
export function dayStart(date: string, addDays = 0): string {
  const [year, month, day] = date.split("-").map(Number);
  const start = new Date(year, month - 1, day + addDays);
  return Number.isNaN(start.getTime()) ? date : start.toISOString();
}
