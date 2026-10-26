import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { BaseResultDto } from "@src/global/dto/base-result.dto";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class StudentAttachmentRequestDto {
  @IsIn(["cv", "portfolio"])
  kind: "cv" | "portfolio";

  // 파일 첨부(source = file, key · file_name)는 CRB-38에서 추가
  @IsIn(["link"])
  source: "link";

  @Transform(trim)
  @IsUrl({ protocols: ["http", "https"], require_protocol: true })
  @MaxLength(2048)
  url: string;
}

// 둘 다 false("희망하지 않음")는 재학생에게 허용하지 않음 (서비스에서 검사)
export class StudentContactRequestDto {
  @IsBoolean()
  email_enabled: boolean;

  @IsBoolean()
  kakao_enabled: boolean;

  @IsOptional()
  @Transform(trim)
  @IsEmail()
  @MaxLength(255)
  email?: string | null;

  // "-" · 공백을 빼고 저장
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.replace(/[\s-]/g, "") : value,
  )
  @Matches(/^01\d{8,9}$/, { message: "phone must be a mobile phone number" })
  phone?: string | null;
}

export class SaveStudentInfoRequestDto {
  // 내 정보의 name이 null일 때만 필수 (서비스에서 검사). 이미 있으면 무시
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name?: string;

  @IsInt()
  department_id: number;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(50, { each: true })
  interests: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(50, { each: true })
  activities?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => StudentAttachmentRequestDto)
  attachments?: StudentAttachmentRequestDto[];

  @IsObject()
  @ValidateNested()
  @Type(() => StudentContactRequestDto)
  contact: StudentContactRequestDto;
}

export class SaveStudentInfoResponseDto extends BaseResultDto {
  // 이번 호출로 가입이 완료됐을 때만
  access_token?: string;
  refresh_token?: string;
}
