import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { OAuthProfile, OAuthVerifier } from "@src/user/oauth/oauth.types";

const PROFILE_URL = "https://openapi.naver.com/v1/nid/me";
const TIMEOUT_MS = 5000;

type NaverProfileResponse = {
  resultcode: string;
  message: string;
  response?: { id?: string; email?: string; name?: string };
};

// Naver는 ID token이 없어 access token으로 프로필 API를 호출해서 확인
@Injectable()
export class NaverVerifier implements OAuthVerifier {
  private readonly logger = new Logger(NaverVerifier.name);

  async verify(token: string): Promise<OAuthProfile> {
    let body: NaverProfileResponse;
    try {
      const res = await fetch(PROFILE_URL, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      body = (await res.json()) as NaverProfileResponse;
    } catch (e) {
      this.logger.debug(
        `Naver profile request failed: ${(e as Error).message}`,
      );
      throw new UnauthorizedException("Invalid OAuth token", { cause: e });
    }

    const profile = body.response;
    if (body.resultcode !== "00" || !profile?.id) {
      this.logger.debug(
        `Naver profile rejected: ${body.resultcode} ${body.message}`,
      );
      throw new UnauthorizedException("Invalid OAuth token");
    }

    return {
      provider: "naver",
      sub: profile.id,
      email: profile.email ?? null,
      name: profile.name ?? null,
    };
  }
}
