import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IdTokenVerifier } from "@src/user/oauth/id-token.verifier";
import {
  OAuthProfile,
  OAuthVerifier,
  parseClientIds,
} from "@src/user/oauth/oauth.types";

@Injectable()
export class AppleVerifier implements OAuthVerifier {
  private readonly idTokenVerifier: IdTokenVerifier;

  constructor(configService: ConfigService) {
    this.idTokenVerifier = new IdTokenVerifier(
      AppleVerifier.name,
      "https://appleid.apple.com/auth/keys",
      ["https://appleid.apple.com"],
      parseClientIds(
        "APPLE_CLIENT_ID",
        configService.get<string>("APPLE_CLIENT_ID"),
      ),
    );
  }

  // Apple ID token에는 이름이 없음 (최초 인증 때 redirect의 user 값으로만 옴) → 추가 정보 입력에서 받음.
  // 이메일은 숨기기를 고르면 릴레이 주소
  async verify(token: string): Promise<OAuthProfile> {
    const payload = await this.idTokenVerifier.verify(token);
    return {
      provider: "apple",
      sub: payload.sub,
      email: typeof payload.email === "string" ? payload.email : null,
      name: null,
    };
  }
}
