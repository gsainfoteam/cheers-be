import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

const TIMEOUT_MS = 5000;

type IdpConfig = { url: string; clientId: string; clientSecret: string };

// Infoteam IdP 호출. 어드민 로그인에만 쓰며, 앱 사용자 로그인은 src/user/oauth
@Injectable()
export class InfoteamIdpService {
  private readonly logger = new Logger(InfoteamIdpService.name);
  private readonly config: IdpConfig | null;

  constructor(configService: ConfigService) {
    const url = configService.get<string>("IDP_URL");
    const clientId = configService.get<string>("IDP_CLIENT_ID");
    const clientSecret = configService.get<string>("IDP_CLIENT_SECRET");

    if (url && clientId && clientSecret) {
      this.config = { url: url.replace(/\/+$/, ""), clientId, clientSecret };
      return;
    }

    if (configService.get<string>("NODE_ENV") === "production") {
      throw new Error(
        "IDP_URL, IDP_CLIENT_ID, IDP_CLIENT_SECRET are required in production.",
      );
    }
    this.logger.warn(
      "IDP_URL, IDP_CLIENT_ID or IDP_CLIENT_SECRET is not set. Manager login will fail.",
    );
    this.config = null;
  }

  // 사용자가 어드민 화면에서 받아 온 code를 IdP access token으로 교환
  async exchangeAuthorizationCode(
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<string> {
    const { url, clientId, clientSecret } = this.requireConfig();
    const res = await fetch(`${url}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // 4xx는 요청 문제, 그 외는 IdP 장애라 500으로 올려 Slack 알림을 받음
    if (res.status >= 400 && res.status < 500) {
      this.logger.debug(`IdP token request rejected: HTTP ${res.status}`);
      throw new UnauthorizedException("Failed to exchange authorization code");
    }
    if (!res.ok) {
      throw new Error(`IdP token request failed: HTTP ${res.status}`);
    }

    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) {
      throw new Error("IdP token response has no access_token");
    }
    return body.access_token;
  }

  async getEmail(accessToken: string): Promise<string | null> {
    const { url } = this.requireConfig();
    const res = await fetch(`${url}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 401) {
      throw new UnauthorizedException("Failed to fetch IdP user info");
    }
    if (!res.ok) {
      throw new Error(`IdP userinfo request failed: HTTP ${res.status}`);
    }

    const body = (await res.json()) as { email?: string };
    return body.email ?? null;
  }

  private requireConfig(): IdpConfig {
    if (!this.config) {
      throw new Error("Infoteam IdP is not configured.");
    }
    return this.config;
  }
}
