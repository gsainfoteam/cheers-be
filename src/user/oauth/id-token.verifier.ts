import { Logger, UnauthorizedException } from "@nestjs/common";
import { createRemoteJWKSet, JWTPayload, jwtVerify } from "jose";

// Google · Apple ID token 공통: provider 서버에 다시 보내지 않고 JWKS 공개키로 서명 · iss · aud · exp만 검증.
// JWKS는 jose가 캐시하고, 모르는 kid가 오면 다시 받아옴
export class IdTokenVerifier {
  private readonly logger: Logger;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    name: string,
    jwksUrl: string,
    private readonly issuers: string[],
    private readonly audiences: string[],
  ) {
    this.logger = new Logger(name);
    this.jwks = createRemoteJWKSet(new URL(jwksUrl));
  }

  async verify(idToken: string): Promise<JWTPayload & { sub: string }> {
    try {
      const { payload } = await jwtVerify(idToken, this.jwks, {
        issuer: this.issuers,
        audience: this.audiences,
      });
      if (!payload.sub) {
        throw new Error("sub claim is missing");
      }
      return payload as JWTPayload & { sub: string };
    } catch (e) {
      this.logger.debug(`Invalid id token: ${(e as Error).message}`);
      throw new UnauthorizedException("Invalid OAuth token", { cause: e });
    }
  }
}
