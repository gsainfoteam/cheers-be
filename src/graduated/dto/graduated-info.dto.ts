import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { COMPANY_PK_MAX } from "@src/company/company.utils";
import { trim } from "@src/global/dto/transforms";
import { ContactRequestDto } from "@src/user/dto/contact-request.dto";

export class GraduatedInfoRequestDto {
  /** 내 정보의 name이 null일 때(첫 저장)만 필수. 이미 있으면 무시 */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name?: string;

  /** 첫 저장에만 필수. 가입 후 변경 불가라 이후 보내면 무시 */
  @IsOptional()
  @Transform(trim)
  @Matches(/^[가-힣A-Za-z0-9_]{2,10}$/, {
    message: "nickname must be 2-10 characters of Korean, letters, digits or _",
  })
  nickname?: string;

  /** 회사 검색(GET /api/v1/company) 결과에서 고른 회사. company_name과 둘 중 하나만 */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(COMPANY_PK_MAX)
  company_id?: number;

  /**
   * 검색 결과에 원하는 회사가 없을 때 직접 입력한 이름. company_id와 둘 중 하나만.
   * 이미 등록된 표기(대소문자 · 공백 무시)면 그 회사로 저장, 아니면 새 회사로 등록되어 어드민 확인을 기다림
   */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  company_name?: string;

  /** 비공개 (다른 회원에게 보이지 않음) */
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  department: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  job: string;

  /** "#" 없이. 최대 5개, 각 1~20자, 중복 불가. 안 보내면 빈 배열로 교체 */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(20, { each: true })
  @Matches(/^[^#]+$/, { each: true, message: "hashtags must not contain #" })
  hashtags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUrl(
    { protocols: ["http", "https"], require_protocol: true },
    { each: true },
  )
  @MaxLength(2048, { each: true })
  links?: string[];

  @ValidateNested()
  @Type(() => ContactRequestDto)
  contact: ContactRequestDto;
}
