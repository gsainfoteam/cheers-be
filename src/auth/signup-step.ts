import { NextStep, UserStatus } from "@src/auth/auth.types";
import { SignupProgress } from "@src/database/repository/user.repository";

// 약관 동의 → 유형별 인증 → 추가 정보 입력 순서. active면 가입 완료.
// 어드민이 명함 인증을 취소한 active 현업자는 재업로드만 하면 되므로 verify (약관 · 추가 정보는 다시 받지 않음)
export function calculateNextStep(
  status: UserStatus,
  progress: SignupProgress,
): NextStep {
  if (status === "active") return progress.verified ? null : "verify";
  if (progress.hasMissingRequiredConsent) return "consent";
  if (!progress.verified) return "verify";
  if (!progress.hasProfile) return "profile";
  return null;
}
