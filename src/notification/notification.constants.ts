const MINUTE_MS = 60 * 1000;

// 발송 실패 뒤 재시도까지의 간격. n번째 시도가 실패하면 [n - 1]만큼 뒤에 다시 보냄 (CRB-75).
// 길이 = 재시도 횟수. 처음 발송 + 3번 재시도까지 실패하면 포기하고 Slack으로 알림
export const NOTIFICATION_RETRY_DELAYS_MS = [
  1 * MINUTE_MS,
  5 * MINUTE_MS,
  30 * MINUTE_MS,
] as const;

// 한 번에 가져와 처리하는 재시도 대상 수
export const NOTIFICATION_RETRY_BATCH_SIZE = 50;
