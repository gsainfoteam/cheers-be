import {
  IsBoolean,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from "class-validator";

// 현황 조회 경로에 그대로 들어가므로 URL에 안전한 문자만 허용
const CONSENT_TYPE_PATTERN = /^[a-z0-9_-]+$/;
const CONSENT_VERSION_PATTERN = /^[A-Za-z0-9._-]+$/;

export class ConsentVersionDto {
  type: string;
  version: string;
  is_required: boolean;
  /** 약관 본문 링크 */
  url: string;
  created_at: Date;
  /** 이 종류의 최신 버전 (사용자에게 보여 주는 버전) */
  is_latest: boolean;
}

export class ConsentTypeDto {
  type: string;
  /** 최신 버전부터 */
  versions: ConsentVersionDto[];
}

export class CreateConsentVersionRequestDto {
  /** 약관 종류. 영문 소문자 · 숫자 · _ · - */
  @IsString()
  @Matches(CONSENT_TYPE_PATTERN)
  @MaxLength(64)
  type: string;

  /** 약관 버전. 영문 · 숫자 · . · _ · - */
  @IsString()
  @Matches(CONSENT_VERSION_PATTERN)
  @MaxLength(32)
  version: string;

  /** 필수 약관이면 동의하지 않은 사용자 전원에게 재동의(consent_required)를 요구함 */
  @IsBoolean()
  is_required: boolean;

  /** 약관 본문 링크 (http, https) */
  @IsUrl({ protocols: ["http", "https"], require_protocol: true })
  @MaxLength(512)
  url: string;
}

export class ConsentVersionParamDto {
  @IsString()
  @Matches(CONSENT_TYPE_PATTERN)
  @MaxLength(64)
  type: string;

  @IsString()
  @Matches(CONSENT_VERSION_PATTERN)
  @MaxLength(32)
  version: string;
}

export class ConsentStatusDto {
  type: string;
  version: string;
  /** 지금 유효한 동의가 있는 사용자 수 (탈퇴 제외) */
  agreed_count: number;
  /** 동의했다가 철회한 상태인 사용자 수 (탈퇴 제외) */
  revoked_count: number;
  /** 동의 이력이 남아 있는 탈퇴 사용자 수 */
  withdrawn_count: number;
}
