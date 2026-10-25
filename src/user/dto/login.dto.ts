import { IsIn, IsNotEmpty, IsString } from "class-validator";
import { UserType } from "@src/auth/auth.types";
import { OAuthProvider } from "@src/user/oauth/oauth.types";

export class LoginRequestDto {
  @IsIn(["google", "apple", "naver"])
  provider: OAuthProvider;

  // 웹에서 먼저 고른 유형. 가입을 마친(active) 유저는 무시
  @IsIn(["student", "graduated"])
  type: UserType;

  // google / apple: ID token, naver: access token
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class LoginResponseDto {
  access_token: string;
  refresh_token: string;
}
