const TOKEN_KEY = "cheers_admin_access_token";
const PKCE_VERIFIER_KEY = "cheers_admin_pkce_verifier";

// 프라이빗 모드처럼 저장소를 쓸 수 없는 환경에서도 화면이 깨지지 않게 예외를 삼킴
function readStorage(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage: () => Storage, key: string, value: string) {
  try {
    storage().setItem(key, value);
  } catch {
    // 저장하지 못하면 다음 단계에서 로그인이 풀린 것처럼 처리됨
  }
}

function removeStorage(storage: () => Storage, key: string) {
  try {
    storage().removeItem(key);
  } catch {
    // 지울 것도 없음
  }
}

const local = () => window.localStorage;
const session = () => window.sessionStorage;

export const getAccessToken = () => readStorage(local, TOKEN_KEY);
export const setAccessToken = (token: string) =>
  writeStorage(local, TOKEN_KEY, token);
export const clearAccessToken = () => removeStorage(local, TOKEN_KEY);

export const loginPagePath = () => `${import.meta.env.BASE_URL}login`;

export function getRedirectUri(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}callback`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

// crypto.subtle은 HTTPS와 localhost에서만 있음. 그 밖에서는 여기서 reject되고, plain으로 되돌아가지 않음
export async function computeCodeChallenge(
  codeVerifier: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );
  return base64UrlEncode(new Uint8Array(digest));
}

export async function buildIdpAuthorizeUrl(): Promise<string> {
  // authorize에는 verifier의 SHA-256 해시를 challenge로 보내고,
  // 콜백에서 verifier 원문을 code_verifier로 보냄
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await computeCodeChallenge(codeVerifier);
  writeStorage(session, PKCE_VERIFIER_KEY, codeVerifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: import.meta.env.VITE_IDP_CLIENT_ID,
    redirect_uri: getRedirectUri(),
    scope: "profile email",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return `${import.meta.env.VITE_IDP_AUTHORIZE_URL}?${params.toString()}`;
}

export const getCodeVerifier = () => readStorage(session, PKCE_VERIFIER_KEY);
export const clearCodeVerifier = () =>
  removeStorage(session, PKCE_VERIFIER_KEY);
