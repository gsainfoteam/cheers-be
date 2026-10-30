import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { OAuthProfile, OAuthVerifier } from "@src/user/oauth/oauth.types";

const PROFILE_URL = "https://openapi.naver.com/v1/nid/me";
const TIMEOUT_MS = 5000;

type NaverProfileResponse = {
  resultcode: string;
  message: string;
  response?: { id?: string; email?: string };
};

// Naver는 ID token이 없어 access token으로 프로필 API를 호출해서 확인.
// 토큰이 cheers 앱에서 발급됐는지는 확인하지 않음. 다만 프로필의 id는 애플리케이션마다 다른 값이라
// (https://developers.naver.com/docs/login/profile/profile.md) 다른 앱의 토큰으로는 기존 cheers 계정에 로그인할 수 없고
// 새 pending 계정만 만들어짐. 막아야 하면 서버에서 authorization code를 client secret으로 교환하는 방식으로 변경
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
    };
  }
}
