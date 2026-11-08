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

const HOUR_MS = 60 * MINUTE_MS;

// 알림톡 최종 결과 동기화 (CRB-77). 접수 후 처음 결과를 조회하기까지의 간격
export const ALIMTALK_DELIVERY_FIRST_CHECK_DELAY_MS = 1 * MINUTE_MS;
// 결과가 아직 없을 때 다시 조회하는 간격. 접수 후 1시간 안에는 짧게, 그 뒤로는 길게
export const ALIMTALK_DELIVERY_SHORT_CHECK_INTERVAL_MS = 5 * MINUTE_MS;
export const ALIMTALK_DELIVERY_SHORT_CHECK_PERIOD_MS = 1 * HOUR_MS;
export const ALIMTALK_DELIVERY_LONG_CHECK_INTERVAL_MS = 1 * HOUR_MS;
// 알리고는 최대 24시간 동안 전송을 시도함. 여유를 두고 이 시간이 지나도 결과가 없으면 unknown으로 확정
export const ALIMTALK_DELIVERY_GIVE_UP_AFTER_MS = 25 * HOUR_MS;
// 조회할 행을 잡아 두는 시간. 조회 중 서버가 죽어도 이 시간 뒤에 다시 조회됨
export const ALIMTALK_DELIVERY_CLAIM_LEASE_MS = 5 * MINUTE_MS;
// 한 번에 잡아 조회하는 수
export const ALIMTALK_DELIVERY_BATCH_SIZE = 50;
