import { BadRequestException } from "@nestjs/common";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  Matches,
  MaxLength,
} from "class-validator";

// 추가 정보 저장 API의 연락 설정 (재학생 · 현업자 공통). 응답은 user-info.dto.ts의 ContactDto
export class ContactRequestDto {
  @IsBoolean()
  email_enabled: boolean;

  @IsBoolean()
  kakao_enabled: boolean;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsEmail()
  @MaxLength(255)
  email?: string | null;

  // "-" · 공백을 빼고 저장
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.replace(/[-\s]/g, "") : value,
  )
  @Matches(/^01\d{8,9}$/, { message: "phone must be a mobile phone number" })
  phone?: string | null;
}

// 고른 연락 방법의 이메일 / 전화번호가 있는지. "하나 이상 골라야 함"은 재학생만 따로 검사
export function assertContactValues(contact: ContactRequestDto): void {
  if (contact.email_enabled && !contact.email) {
    throw new BadRequestException("Contact email is required");
  }
  if (contact.kakao_enabled && !contact.phone) {
    throw new BadRequestException("Contact phone is required");
  }
}
