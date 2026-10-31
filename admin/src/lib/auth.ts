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

function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function buildIdpAuthorizeUrl(): string {
  // IdP가 code_challenge_method=plain을 쓰므로 verifier를 그대로 challenge로 보내고,
  // 콜백에서 같은 값을 code_verifier로 다시 보냄
  const codeVerifier = generateCodeVerifier();
  writeStorage(session, PKCE_VERIFIER_KEY, codeVerifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: import.meta.env.VITE_IDP_CLIENT_ID,
    redirect_uri: getRedirectUri(),
    scope: "profile email",
    code_challenge: codeVerifier,
    code_challenge_method: "plain",
  });

  return `${import.meta.env.VITE_IDP_AUTHORIZE_URL}?${params.toString()}`;
}

export const getCodeVerifier = () => readStorage(session, PKCE_VERIFIER_KEY);
export const clearCodeVerifier = () =>
  removeStorage(session, PKCE_VERIFIER_KEY);
