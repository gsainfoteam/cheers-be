import { Transform } from "class-transformer";
import { IsEmail, MaxLength } from "class-validator";

export class SendCodeRequestDto {
  // 도메인 비교를 위해 소문자로 정규화
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  email: string;
}

export class SendCodeResponseDto {
  expires_at: Date;
  resend_available_at: Date;
}
