import { BaseResultDto } from "@src/global/dto/base-result.dto";

// 추가 정보 저장 API 응답. 이번 호출로 가입이 완료됐을 때만 새 토큰을 줌
export class SignupCompleteResponseDto extends BaseResultDto {
  /** 이번 호출로 가입이 완료됐을 때만 */
  access_token?: string;
  /** 이번 호출로 가입이 완료됐을 때만 */
  refresh_token?: string;
}
