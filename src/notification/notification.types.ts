import { SendMailInput } from "@src/mail/mail.types";
import {
  notificationChannel,
  notificationDeliveryStatus,
  notificationEvent,
  notificationStatus,
} from "@drizzle/schema/enums";
import { AlimtalkVariablesMap } from "./alimtalk.types";

export type NotificationEvent = (typeof notificationEvent.enumValues)[number];
export type NotificationChannel =
  (typeof notificationChannel.enumValues)[number];
export type NotificationStatus = (typeof notificationStatus.enumValues)[number];
export type NotificationDeliveryStatus =
  (typeof notificationDeliveryStatus.enumValues)[number];

export interface NotifyInput<E extends NotificationEvent = NotificationEvent> {
  coffeeChatRequestPk: string;
  event: E;
  // 받는 사람이 켠 채널만 넘김
  email?: SendMailInput;
  alimtalk?: {
    to: string;
    variables: AlimtalkVariablesMap[E];
  };
}

export interface NotificationLogInput {
  coffeeChatRequestPk: string;
  event: NotificationEvent;
  channel: NotificationChannel;
  status: NotificationStatus;
  recipient: string;
  providerMessageId?: string;
  error?: string;
  attempt: number;
  nextRetryAt: Date | null;
  // 접수된 알림톡만 pending과 첫 조회 시각을 넣음 (CRB-77)
  deliveryStatus?: NotificationDeliveryStatus;
  deliveryNextCheckAt?: Date;
}

// 한 채널 발송 결과. skipped: 실제로 보내지 않음 (로컬 · 키 미설정), gave_up: 마지막 시도까지 실패
export type NotificationOutcome = "sent" | "failed" | "gave_up" | "skipped";
