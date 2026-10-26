import { Logger, UnauthorizedException } from "@nestjs/common";
import { createRemoteJWKSet, JWTPayload, jwtVerify } from "jose";
import { createHash } from "node:crypto";

// Google · Apple ID token 공통: provider 서버에 다시 보내지 않고 JWKS 공개키로 서명 · iss · aud · exp와 nonce를 검증.
// JWKS는 jose가 캐시하고, 모르는 kid가 오면 다시 받아옴
//
// nonce: 클라이언트가 임의 문자열을 만들어 보관하고 SHA-256(hex)을 provider에 넘김 → ID token의 nonce 클레임에 들어옴.
// 로그인 요청에는 원문을 보내고 서버는 해시가 같은지만 확인. redirect URL 등으로 ID token만 유출돼서는 재사용할 수 없음
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

  async verify(
    idToken: string,
    nonce: string | undefined,
  ): Promise<JWTPayload & { sub: string }> {
    try {
      if (!nonce) {
        throw new Error("nonce is missing");
      }
      const { payload } = await jwtVerify(idToken, this.jwks, {
        issuer: this.issuers,
        audience: this.audiences,
      });
      if (!payload.sub) {
        throw new Error("sub claim is missing");
      }
      const expectedNonce = createHash("sha256").update(nonce).digest("hex");
      if (payload.nonce !== expectedNonce) {
        throw new Error("nonce claim does not match");
      }
      return payload as JWTPayload & { sub: string };
    } catch (e) {
      this.logger.debug(`Invalid id token: ${(e as Error).message}`);
      throw new UnauthorizedException("Invalid OAuth token", { cause: e });
    }
  }
}
