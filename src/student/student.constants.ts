// 학교 이메일 인증
export const VERIFICATION_CODE_TTL_MINUTES = 5;
export const VERIFICATION_CODE_TTL_MS =
  VERIFICATION_CODE_TTL_MINUTES * 60 * 1000;
// 마지막 전송(created_at) 후 재전송까지 기다릴 시간
export const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
// 이 횟수만큼 틀리면 그 인증코드는 무효
export const VERIFICATION_MAX_ATTEMPTS = 5;
