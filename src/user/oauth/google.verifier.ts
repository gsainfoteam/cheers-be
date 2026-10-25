import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IdTokenVerifier } from "@src/user/oauth/id-token.verifier";
import {
  OAuthProfile,
  OAuthVerifier,
  parseClientIds,
} from "@src/user/oauth/oauth.types";

@Injectable()
export class GoogleVerifier implements OAuthVerifier {
  private readonly idTokenVerifier: IdTokenVerifier;

  constructor(configService: ConfigService) {
    this.idTokenVerifier = new IdTokenVerifier(
      GoogleVerifier.name,
      "https://www.googleapis.com/oauth2/v3/certs",
      ["https://accounts.google.com", "accounts.google.com"],
      parseClientIds(
        "GOOGLE_CLIENT_ID",
        configService.get<string>("GOOGLE_CLIENT_ID"),
      ),
    );
  }

  async verify(token: string, nonce?: string): Promise<OAuthProfile> {
    const payload = await this.idTokenVerifier.verify(token, nonce);
    return {
      provider: "google",
      sub: payload.sub,
      // 소유 확인이 안 된 이메일은 저장하지 않음
      email:
        typeof payload.email === "string" && payload.email_verified === true
          ? payload.email
          : null,
      name: typeof payload.name === "string" ? payload.name : null,
    };
  }
}
