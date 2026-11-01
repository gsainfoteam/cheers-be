import { ApiProperty } from "@nestjs/swagger";

export const BUSINESS_CARD_SIGNUP_STATUSES = [
  "pending",
  "active",
  "withdrawal_requested",
] as const;

export type BusinessCardSignupStatus =
  (typeof BUSINESS_CARD_SIGNUP_STATUSES)[number];

export class BusinessCardGraduatedDto {
  graduated_pk: string;
  name: string | null;

  /** 추가 정보 입력 전이면 null */
  nickname: string | null;

  /** 추가 정보 입력 전이면 null */
  company: string | null;

  /** 추가 정보 입력 전이면 null */
  job: string | null;

  /** 명함 업로드 여부. 인증을 취소하면 false */
  has_business_card: boolean;

  /** 명함 인증 시각. 미인증 · 인증 취소면 null */
  verified_at: Date | null;

  /** 가입 상태. withdrawal_requested: 탈퇴 유예기간 중 */
  @ApiProperty({ enum: BUSINESS_CARD_SIGNUP_STATUSES })
  signup_status: BusinessCardSignupStatus;
}

export class BusinessCardImageUrlDto {
  /** 명함 이미지 presigned GET URL */
  url: string;

  /** URL 만료까지 남은 시간 (초) */
  expires_in: number;
}
