import { Injectable } from "@nestjs/common";
import { AppleVerifier } from "@src/user/oauth/apple.verifier";
import { GoogleVerifier } from "@src/user/oauth/google.verifier";
import { NaverVerifier } from "@src/user/oauth/naver.verifier";
import {
  OAuthProfile,
  OAuthProvider,
  OAuthVerifier,
} from "@src/user/oauth/oauth.types";

@Injectable()
export class OAuthService {
  private readonly verifiers: Record<OAuthProvider, OAuthVerifier>;

  constructor(
    googleVerifier: GoogleVerifier,
    appleVerifier: AppleVerifier,
    naverVerifier: NaverVerifier,
  ) {
    this.verifiers = {
      google: googleVerifier,
      apple: appleVerifier,
      naver: naverVerifier,
    };
  }

  // google / apple: ID token, naver: access token
  verify(provider: OAuthProvider, token: string): Promise<OAuthProfile> {
    return this.verifiers[provider].verify(token);
  }
}
