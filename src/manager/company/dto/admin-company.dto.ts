import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { PaginationQueryDto } from "@src/cheers/dto/pagination.dto";
import { COMPANY_PK_MAX } from "@src/company/company.utils";

// 앞뒤 공백을 지우고 유니코드 표현을 맞춤 (공백뿐이면 @IsNotEmpty에 걸림)
const normalizeName = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().normalize("NFC") : value;

const normalizeNames = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((v) => (typeof v === "string" ? v.trim().normalize("NFC") : v))
    : value;

// 제어 문자(NUL은 PostgreSQL이 거부해 500이 됨)를 막고, 폭 없는 문자만으로 된 이름처럼 눈에 안 보이는 이름도 막음
const VISIBLE_NAME = /^(?=.*[^\p{Z}\p{C}])\P{Cc}*$/su;

export class AdminCompanyListQueryDto extends PaginationQueryDto {
  /** 표기 중 하나라도 포함하면 걸림 (대소문자 · 공백 무시) */
  @IsOptional()
  @Transform(normalizeName)
  @IsString()
  @MaxLength(128)
  q?: string;
}

export class AdminCompanyNameDto {
  name_id: number;
  name: string;
}

export class AdminCompanyDto {
  company_id: number;
  name: string;
  /** 로고 presigned GET URL. 없으면 null */
  logo_url: string | null;
  /** true: 현업자가 직접 입력해 생긴 회사로 아직 확인하지 않음 */
  needs_review: boolean;
  /** 검색에 쓰이는 표기 (회사 이름 포함) */
  names: AdminCompanyNameDto[];
  /** 이 회사를 고른 현업자 수 */
  graduated_count: number;
  created_at: string;
}

export class CreateAdminCompanyRequestDto {
  /** 화면에 나갈 회사 이름. 표기에도 자동으로 들어감 */
  @Transform(normalizeName)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(VISIBLE_NAME)
  name: string;

  /** 함께 등록할 다른 표기 (예: 마이크로소프트, 마소, MS) */
  @IsOptional()
  @Transform(normalizeNames)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(128, { each: true })
  @Matches(VISIBLE_NAME, { each: true })
  names?: string[];
}

export class UpdateAdminCompanyRequestDto {
  /** 회사 이름 변경. 새 이름은 표기에도 추가되고 기존 표기는 남음 */
  @IsOptional()
  @Transform(normalizeName)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(VISIBLE_NAME)
  name?: string;

  /** false로 보내면 검토 완료 (승인) */
  @IsOptional()
  @IsBoolean()
  needs_review?: boolean;
}

export class AdminCompanyNameRequestDto {
  @Transform(normalizeName)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(VISIBLE_NAME)
  name: string;
}

export class MergeAdminCompanyRequestDto {
  /** 합쳐질 회사. 요청 경로의 회사가 이 회사로 합쳐지고 지워짐 */
  @IsInt()
  @Min(1)
  @Max(COMPANY_PK_MAX)
  target_id: number;
}

export class UpdateAdminCompanyLogoRequestDto {
  /** 로고 업로드 URL 발급 때 받은 key */
  @IsString()
  @IsNotEmpty()
  key: string;
}
