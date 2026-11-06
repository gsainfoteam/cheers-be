import { Transform } from "class-transformer";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";
import { trim } from "@src/global/dto/transforms";

export class CompanySearchQueryDto {
  /** 검색어. 표기(대소문자 · 공백 무시)의 일부만 맞아도 걸림 */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  q: string;
}

export class CompanySearchItemDto {
  company_id: number;
  /** 화면에 나갈 회사 이름 */
  name: string;
  /** 로고 presigned GET URL. 로고가 없으면 null */
  logo_url: string | null;
  /** 검색어와 맞은 표기 (예: 검색어 "마소" → "마소", name은 "Microsoft") */
  matched_name: string;
}
