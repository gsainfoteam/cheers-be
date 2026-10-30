import { Transform } from "class-transformer";
import { IsEmail, Matches, MaxLength } from "class-validator";
import { ErrorResponseDto } from "@src/global/dto/error-response.dto";

export class SendCodeRequestDto {
  /** 소문자로 정규화해 저장. plus 주소(a+1@)는 받지 않음 */
  // 도메인 비교를 위해 소문자로 정규화
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  // plus 주소(a+1@)가 같은 메일함으로 가면 한 사람이 여러 계정을 인증할 수 있어 받지 않음
  @Matches(/^[^+]+@/, { message: "email must not contain '+'" })
  email: string;
}

export class SendCodeResponseDto {
  expires_at: Date;
  resend_available_at: Date;
}

export class EmailAlreadyRegisteredErrorDto extends ErrorResponseDto {
  /** 항상 "EMAIL_ALREADY_REGISTERED" */
  error_code: "EMAIL_ALREADY_REGISTERED";
}

export class SendCodeRateLimitErrorDto extends ErrorResponseDto {
  /** 다시 보낼 수 있는 시각 */
  retry_available_at: Date;
}
