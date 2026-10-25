import { NextStep, UserStatus } from "@src/auth/auth.types";
import { SignupProgress } from "@src/database/repository/user.repository";

// 약관 동의 → 유형별 인증 → 추가 정보 입력 순서. active면 가입 완료
export function calculateNextStep(
  status: UserStatus,
  progress: SignupProgress,
): NextStep {
  if (status === "active") return null;
  if (progress.hasMissingRequiredConsent) return "consent";
  if (!progress.verified) return "verify";
  if (!progress.hasProfile) return "profile";
  return null;
}
