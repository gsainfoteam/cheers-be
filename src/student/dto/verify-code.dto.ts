import { Matches } from "class-validator";
import { ErrorResponseDto } from "@src/global/dto/error-response.dto";

export class VerifyCodeRequestDto {
  @Matches(/^\d{6}$/, { message: "code must be 6 digits" })
  code: string;
}

export class VerifyCodeErrorDto extends ErrorResponseDto {
  /** 남은 시도 횟수. 인증코드가 틀렸을 때만 내려 줌 */
  remaining_attempts?: number;
}
