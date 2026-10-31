import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from "class-validator";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

// 인증 이메일도 소문자로 저장해 비교하므로 소문자로 맞춤 (중복 검사 전에 실행됨)
const normalizeDomains = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((v: unknown) =>
        typeof v === "string" ? v.trim().toLowerCase() : v,
      )
    : value;

// 영문 소문자 · 숫자 · 하이픈 라벨을 점으로 이음. 마지막 라벨은 영문 2자 이상.
// @ · 와일드카드 · 포트 · 한글은 받지 않음 (LIKE 특수문자도 여기서 걸러짐)
const EMAIL_DOMAIN_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export class SchoolDto {
  pk: number;
  name: string;
  /** 학교 이메일 인증 시 허용 도메인 */
  email_domains: string[];
}

export class DepartmentAdminDto {
  pk: number;
  school_pk: number;
  name: string;
  /** false면 앱의 학과 목록에서 숨기고 새로 고를 수 없음 */
  is_active: boolean;
}

export class CreateDepartmentRequestDto {
  /** 같은 학교에서 중복 불가 (비활성 학과 포함) */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name: string;
}

export class UpdateDepartmentRequestDto {
  /** 같은 학교에서 중복 불가 (비활성 학과 포함). name · is_active 중 하나는 필수 */
  @ValidateIf((o: UpdateDepartmentRequestDto) => o.name !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name?: string;

  /** false: 비활성화, true: 재활성화 */
  @ValidateIf((o: UpdateDepartmentRequestDto) => o.is_active !== undefined)
  @IsBoolean()
  is_active?: boolean;
}

export class ReplaceEmailDomainsRequestDto {
  /** 이 목록으로 전체 교체. 1~20개, 소문자로 저장 */
  @ApiProperty({ type: [String], example: ["gm.gist.ac.kr"] })
  @Transform(normalizeDomains)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  @Matches(EMAIL_DOMAIN_PATTERN, {
    each: true,
    message: "each value in email_domains must be a valid domain",
  })
  email_domains: string[];
}
