import { UserOauthAccountRow } from "@src/database/repository/user-oauth-account.repository";

export type OAuthProvider = UserOauthAccountRow["provider"];

// 지금 로그인을 받는 provider. Apple · Naver는 검증 코드는 있지만 앱 등록 · 연동 확인 전이라 막아 둠.
// 여는 법: 여기에 추가 + UserModule providers에 해당 Verifier 등록 + OAuthService 생성자에서 연결 (+ APPLE_CLIENT_ID)
export const ENABLED_OAUTH_PROVIDERS: OAuthProvider[] = ["google"];

// provider가 확인해 준 계정 정보. sub는 user_oauth_account.provider_sub.
// 이름은 받지 않음 (추가 정보 입력에서 사용자에게 받음)
export type OAuthProfile = {
  provider: OAuthProvider;
  sub: string;
  email: string | null;
};

export interface OAuthVerifier {
  // 검증에 실패하면 UnauthorizedException. nonce는 ID token을 쓰는 google / apple만 사용
  verify(token: string, nonce?: string): Promise<OAuthProfile>;
}

// env에 쉼표로 여러 client ID를 넣을 수 있음 (웹 / 앱 client 분리 대비)
export function parseClientIds(
  name: string,
  value: string | undefined,
): string[] {
  const ids = (value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (ids.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return ids;
}
