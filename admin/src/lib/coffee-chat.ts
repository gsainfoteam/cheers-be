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

export type NotificationLog = {
  pk: string;
  event: "coffee_chat_requested" | "contact_shared";
  channel: "email" | "kakao_alimtalk";
  status: "sent" | "failed";
  error: string | null;
  created_at: string;
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

export const LOG_STATUS_LABELS: Record<NotificationLog["status"], string> = {
  sent: "성공",
  failed: "실패",
};

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
export function dayStart(date: string, addDays = 0): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day + addDays).toISOString();
}
