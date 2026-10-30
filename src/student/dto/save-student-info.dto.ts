import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { ContactRequestDto } from "@src/user/dto/contact-request.dto";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

// 배열의 문자열 항목마다 trim (공백뿐인 항목은 빈 문자열이 되어 @IsNotEmpty에 걸림)
const trimEach = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((v: unknown) => (typeof v === "string" ? v.trim() : v))
    : value;

export class StudentAttachmentRequestDto {
  @IsIn(["cv", "portfolio"])
  kind: "cv" | "portfolio";

  @IsIn(["link", "file"])
  source: "link" | "file";

  /** source가 link일 때 필수. link: url만 받음, file: key · file_name만 받음 (섞으면 400) */
  @ValidateIf((o: StudentAttachmentRequestDto) => o.source !== "file")
  @Transform(trim)
  @IsUrl({ protocols: ["http", "https"], require_protocol: true })
  @MaxLength(2048)
  url?: string;

  /** source가 file일 때 필수. 업로드 URL 발급 때 받은 key(새 파일) 또는 내 정보 조회가 내려준 key(기존 파일 유지) */
  @ValidateIf((o: StudentAttachmentRequestDto) => o.source !== "link")
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  key?: string;

  /** source가 file일 때 필수 */
  @ValidateIf((o: StudentAttachmentRequestDto) => o.source !== "link")
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  file_name?: string;
}

export class SaveStudentInfoRequestDto {
  /** 내 정보의 name이 null일 때(첫 저장)만 필수. 이미 있으면 무시 */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name?: string;

  @IsInt()
  department_id: number;

  @Transform(trimEach)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(50, { each: true })
  interests: string[];

  @IsOptional()
  @Transform(trimEach)
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
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

  /** 둘 다 false("희망하지 않음")는 재학생에게 허용하지 않음 */
  @IsObject()
  @ValidateNested()
  @Type(() => ContactRequestDto)
  contact: ContactRequestDto;
}
