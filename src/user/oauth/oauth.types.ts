import { UserOauthAccountRow } from "@src/database/repository/user-oauth-account.repository";

export type OAuthProvider = UserOauthAccountRow["provider"];

// provider가 확인해 준 계정 정보. sub는 user_oauth_account.provider_sub
export type OAuthProfile = {
  provider: OAuthProvider;
  sub: string;
  email: string | null;
  name: string | null;
};

export interface OAuthVerifier {
  // 검증에 실패하면 UnauthorizedException
  verify(token: string): Promise<OAuthProfile>;
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
