import { BadRequestException } from "@nestjs/common";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  Matches,
  MaxLength,
} from "class-validator";
import { CoffeeChatContactInput } from "@src/database/repository/coffee-chat-contact.repository";

// 추가 정보 저장 API의 연락 설정 (재학생 · 현업자 공통). 응답은 user-info.dto.ts의 ContactDto
// 값이 없는 email / phone은 ""가 아니라 null 또는 생략으로 받기로 프론트와 약속 ("" 는 형식 오류로 400)
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

// coffee_chat_contact 저장 값. 끈 연락 방법의 이메일 / 전화번호는 요청에 값이 있어도 지움
// ("희망하지 않음"으로 바꾸면 연락처를 남기지 않음)
export function toContactRow(
  userPk: string,
  contact: ContactRequestDto,
): CoffeeChatContactInput {
  return {
    userPk,
    emailEnabled: contact.email_enabled,
    kakaoEnabled: contact.kakao_enabled,
    email: contact.email_enabled ? (contact.email ?? null) : null,
    phone: contact.kakao_enabled ? (contact.phone ?? null) : null,
  };
}
