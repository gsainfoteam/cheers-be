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

// 알리고 전송결과 조회로 본 알림톡 한 건의 카카오 단계 결과 (CRB-77). throw하지 않음
export type AlimtalkDeliveryResult =
  // 아직 전송 중 (알리고는 최대 24시간 동안 시도함)
  | { status: "pending" }
  | {
      status: "delivered" | "failed";
      // rslt
      code: string;
      // rslt_message
      message: string | null;
      // rsltdate. 비어 있으면 null
      reportedAt: Date | null;
    }
  // 조회 자체가 실패함 (인증 · 네트워크 · 응답 형식). 다음 실행에서 다시 조회
  | { status: "error"; error: string };

// 알리고 잔여 충전금액 · 건수 조회 결과 (CRB-78). throw하지 않음
export type AligoBalanceResult =
  // 키가 설정되지 않음 (로컬)
  | { status: "not_configured" }
  | {
      status: "ok";
      // 잔여 충전금액. 응답에서 찾지 못하면 null
      amount: number | null;
      // 유형별 잔여 건수. 키는 알리고 응답의 필드명(소문자)
      counts: Record<string, number>;
    }
  // 조회 자체가 실패함 (인증 · 네트워크 · 응답 형식)
  | { status: "error"; error: string };
