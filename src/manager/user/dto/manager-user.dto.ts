import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";
import {
  CreatedPeriodQueryDto,
  toKeyword,
} from "@src/manager/coffee-chat/dto/manager-coffee-chat.dto";
import { oauthProvider, userStatus, userType } from "@drizzle/schema/enums";

export const USER_WITHDRAWAL_STATES = ["none", "requested", "deleted"] as const;
export type UserWithdrawalState = (typeof USER_WITHDRAWAL_STATES)[number];

const WITHDRAWAL_FILTERS = ["all", ...USER_WITHDRAWAL_STATES] as const;

export class UserListQueryDto extends CreatedPeriodQueryDto {
  @ApiPropertyOptional({ enum: userType.enumValues })
  @IsOptional()
  @IsIn(userType.enumValues)
  type?: (typeof userType.enumValues)[number];

  @ApiPropertyOptional({ enum: userStatus.enumValues })
  @IsOptional()
  @IsIn(userStatus.enumValues)
  status?: (typeof userStatus.enumValues)[number];

  /** none: 정상, requested: 탈퇴 유예 중, deleted: 탈퇴 완료. 생략하거나 all이면 전체 */
  @ApiPropertyOptional({ enum: WITHDRAWAL_FILTERS })
  @IsOptional()
  @IsIn(WITHDRAWAL_FILTERS)
  withdrawal?: (typeof WITHDRAWAL_FILTERS)[number];

  /** pk · 이름 · 이메일 (부분 일치, 대소문자 무시). 탈퇴 완료 회원은 pk로 찾음 */
  @IsOptional()
  @Transform(toKeyword)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  q?: string;
}

export class UserAffiliationDto {
  /** 재학생의 학교 */
  school: string | null;
  /** 재학생의 학과 */
  department: string | null;
  /** 현업자의 회사 */
  company: string | null;
  /** 현업자의 직무 */
  job: string | null;
}

// 연락처 · OAuth 식별자는 넣지 않음
export class UserListItemDto {
  pk: string;
  /** 추가 정보 입력 전이거나 탈퇴 처리 후에는 null */
  name: string | null;
  email: string | null;
  @ApiProperty({ enum: userType.enumValues })
  type: (typeof userType.enumValues)[number];
  @ApiProperty({ enum: userStatus.enumValues })
  status: (typeof userStatus.enumValues)[number];
  @ApiProperty({ enum: USER_WITHDRAWAL_STATES })
  withdrawal_state: UserWithdrawalState;
  affiliation: UserAffiliationDto;
  created_at: Date;
  last_active_at: Date;
}

export class UserOauthAccountDto {
  @ApiProperty({ enum: oauthProvider.enumValues })
  provider: (typeof oauthProvider.enumValues)[number];
  email: string | null;
  created_at: Date;
  last_login_at: Date | null;
}

export class UserContactMethodsDto {
  kakao_enabled: boolean;
  email_enabled: boolean;
}

export class UserConsentDto {
  type: string;
  version: string;
  agreed_at: Date;
  revoked_at: Date | null;
}

export class UserStudentDto {
  student_pk: string;
  school_email: string | null;
  verified_at: Date | null;
  school: string | null;
  department: string | null;
  interests: string[] | null;
  activities: string[] | null;
}

// 명함 사진 · 회사 부서 외 비공개 정보는 넣지 않음. 명함은 graduated_pk로 명함 API를 호출
export class UserGraduatedDto {
  graduated_pk: string;
  verified_at: Date | null;
  has_business_card: boolean;
  nickname: string | null;
  company: string | null;
  department: string | null;
  job: string | null;
  hashtags: string[] | null;
  links: string[] | null;
}

// 연락처 값(phone · email) · OAuth 식별자 · 토큰은 넣지 않음
export class UserDetailDto {
  pk: string;
  name: string | null;
  email: string | null;
  @ApiProperty({ enum: userType.enumValues })
  type: (typeof userType.enumValues)[number];
  @ApiProperty({ enum: userStatus.enumValues })
  status: (typeof userStatus.enumValues)[number];
  @ApiProperty({ enum: USER_WITHDRAWAL_STATES })
  withdrawal_state: UserWithdrawalState;
  created_at: Date;
  updated_at: Date;
  last_active_at: Date;
  withdraw_requested_at: Date | null;
  oauth_accounts: UserOauthAccountDto[];
  /** 연락수단을 입력하기 전(가입 중)이거나 탈퇴 처리 후에는 null */
  contact_methods: UserContactMethodsDto | null;
  consents: UserConsentDto[];
  student: UserStudentDto | null;
  graduated: UserGraduatedDto | null;
  /** 재학생은 보낸 요청 수, 현업자는 받은 요청 수 */
  coffee_chat_request_count: number;
}

export class UserContactDto {
  kakao_enabled: boolean;
  email_enabled: boolean;
  phone: string | null;
  email: string | null;
}
