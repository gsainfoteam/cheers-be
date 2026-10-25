import { NotificationEvent } from "./notification.types";

export interface CoffeeChatRequestedVariables {
  // 알림을 받는 현업자 이름
  recipientName: string;
  coffeeChatRequestPk: string;
}

export interface ContactSharedVariables {
  // 알림을 받는 재학생 이름
  recipientName: string;
  graduatedName: string;
  coffeeChatRequestPk: string;
}

export interface AlimtalkVariablesMap {
  coffee_chat_requested: CoffeeChatRequestedVariables;
  contact_shared: ContactSharedVariables;
}

export interface SendAlimtalkInput<
  E extends NotificationEvent = NotificationEvent,
> {
  event: E;
  // 휴대전화번호 ("-" 없음)
  to: string;
  variables: AlimtalkVariablesMap[E];
}

export interface AlimtalkResult {
  success: boolean;
  messageId?: string;
  error?: string;
  // 키가 설정되지 않아 실제로 발송하지 않음
  skipped?: boolean;
}
