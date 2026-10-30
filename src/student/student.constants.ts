// 학교 이메일 인증
export const VERIFICATION_CODE_TTL_MINUTES = 5;
export const VERIFICATION_CODE_TTL_MS =
  VERIFICATION_CODE_TTL_MINUTES * 60 * 1000;
// 마지막 전송(created_at) 후 재전송까지 기다릴 시간
export const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
// 이 횟수만큼 틀리면 그 인증코드는 무효
export const VERIFICATION_MAX_ATTEMPTS = 5;
// 아래 상한을 세는 기간 (최근 24시간)
export const VERIFICATION_SEND_WINDOW_MS = 24 * 60 * 60 * 1000;
// 전송 기록 보존 기간 (스케줄러가 하루 한 번 지움). 상한을 세는 기간에 여유를 둠 (서버 간 시각 차이 대비, CRB-29에서 결정)
export const VERIFICATION_SEND_LOG_RETENTION_MS =
  2 * VERIFICATION_SEND_WINDOW_MS;
// 기간 안에 한 유저가 보낼 수 있는 횟수
export const VERIFICATION_MAX_SENDS_PER_USER = 5;
// 기간 안에 한 이메일로 보낼 수 있는 횟수 (모든 계정 합산)
export const VERIFICATION_MAX_SENDS_PER_EMAIL = 10;
// 기간 안에 한 유저가 틀린 횟수가 여기에 닿으면 재전송 불가 (재전송해도 초기화되지 않음)
export const VERIFICATION_MAX_FAILED_ATTEMPTS = 10;
