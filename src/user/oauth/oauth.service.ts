import { BadRequestException, Injectable } from "@nestjs/common";
import { GoogleVerifier } from "@src/user/oauth/google.verifier";
import {
  OAuthProfile,
  OAuthProvider,
  OAuthVerifier,
} from "@src/user/oauth/oauth.types";

// 지금은 Google만 연결 (ENABLED_OAUTH_PROVIDERS). AppleVerifier · NaverVerifier는 열 때 여기에 추가
@Injectable()
export class OAuthService {
  private readonly verifiers: Partial<Record<OAuthProvider, OAuthVerifier>>;

  constructor(googleVerifier: GoogleVerifier) {
    this.verifiers = { google: googleVerifier };
  }

  // google / apple: ID token + nonce 원문, naver: access token
  async verify(
    provider: OAuthProvider,
    token: string,
    nonce?: string,
  ): Promise<OAuthProfile> {
    const verifier = this.verifiers[provider];
    if (!verifier) {
      // 요청 검증(LoginRequestDto)에서 먼저 막히지만 서비스에서도 한 번 더 확인
      throw new BadRequestException(`Unsupported provider: ${provider}`);
    }
    return verifier.verify(token, nonce);
  }
}
