import { IsNotEmpty, IsString } from "class-validator";

export class RefreshRequestDto {
  /** 로그인 또는 가입 완료 때 받은 refresh token. 만료 전까지 계속 사용 */
  @IsString()
  @IsNotEmpty()
  refresh_token: string;
}

export class RefreshResponseDto {
  /** 새 access token. refresh token은 응답에 없음 (재발급 없음) */
  access_token: string;
}
