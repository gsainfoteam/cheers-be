import { SendMailInput } from "@src/mail/mail.types";
import {
  notificationChannel,
  notificationEvent,
  notificationStatus,
} from "../../drizzle/schema/enums";
import { AlimtalkVariablesMap } from "./alimtalk.types";

export type NotificationEvent = (typeof notificationEvent.enumValues)[number];
export type NotificationChannel =
  (typeof notificationChannel.enumValues)[number];
export type NotificationStatus = (typeof notificationStatus.enumValues)[number];

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
}
