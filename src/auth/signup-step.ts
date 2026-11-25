import { NextStep, UserStatus, UserType } from "@src/auth/auth.types";
import { SignupProgress } from "@src/database/repository/user.repository";

// 약관 동의 → 인증 → 추가 정보 입력 순서. active면 가입 완료.
// 인증은 재학생(학교 이메일)만 거침. 현업자의 명함은 선택이라 단계에 없고 verified_at도 보지 않음
export function calculateNextStep(
  status: UserStatus,
  type: UserType,
  progress: SignupProgress,
): NextStep {
  const needsVerify = type === "student" && !progress.verified;
  if (status === "active") return needsVerify ? "verify" : null;
  if (progress.hasMissingRequiredConsent) return "consent";
  if (needsVerify) return "verify";
  if (!progress.hasProfile) return "profile";
  return null;
}
