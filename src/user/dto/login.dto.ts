import {
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from "class-validator";
import { UserType } from "@src/auth/auth.types";
import {
  ENABLED_OAUTH_PROVIDERS,
  OAuthProvider,
} from "@src/user/oauth/oauth.types";

export class LoginRequestDto {
  // 지금은 google만 받음. apple · naver는 400 (ENABLED_OAUTH_PROVIDERS)
  @IsIn(ENABLED_OAUTH_PROVIDERS)
  provider: OAuthProvider;

  // 웹에서 먼저 고른 유형. 가입을 마친(active) 유저는 무시
  @IsIn(["student", "graduated"])
  type: UserType;

  // google / apple: ID token, naver: access token
  @IsString()
  @IsNotEmpty()
  token: string;

  // google / apple만 필수: 로그인 시작 때 만든 nonce 원문. provider에는 SHA-256(hex)을 넘김
  @ValidateIf((o: LoginRequestDto) => o.provider !== "naver")
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  nonce?: string;
}

export class LoginResponseDto {
  access_token: string;
  refresh_token: string;
}
