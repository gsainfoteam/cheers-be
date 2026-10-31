import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import {
  clearCodeVerifier,
  getCodeVerifier,
  getRedirectUri,
  setAccessToken,
} from "../lib/auth";

type ManagerLoginResponse = { access_token: string };

function loginErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) {
    return "어드민으로 등록되지 않은 계정입니다. 담당자에게 등록을 요청해 주세요.";
  }
  return "로그인에 실패했습니다. 다시 시도해 주세요.";
}

export function CallbackPage() {
  const navigate = useNavigate();
  const [{ code, codeVerifier }] = useState(() => ({
    code: new URLSearchParams(window.location.search).get("code"),
    codeVerifier: getCodeVerifier(),
  }));
  const [loginError, setLoginError] = useState<string | null>(null);
  // StrictMode에서 effect가 두 번 돌아도 code를 한 번만 보냄
  const requested = useRef(false);

  const error =
    code && codeVerifier
      ? loginError
      : "로그인 정보가 없습니다. 처음부터 다시 로그인해 주세요.";

  useEffect(() => {
    // 한 번 쓰면 지움. 콜백 새로고침으로 같은 code를 다시 보내지 않게 함
    clearCodeVerifier();
    if (!code || !codeVerifier || requested.current) return;
    requested.current = true;

    api
      .post<ManagerLoginResponse>("/api/manager/v1/auth/login", {
        code,
        redirect_uri: getRedirectUri(),
        code_verifier: codeVerifier,
      })
      .then((res) => {
        setAccessToken(res.access_token);
        navigate("/", { replace: true });
      })
      .catch((err: unknown) => setLoginError(loginErrorMessage(err)));
  }, [code, codeVerifier, navigate]);

  return (
    <div className="login-screen">
      <div className="login-card">
        {error ? (
          <>
            <h1>로그인 실패</h1>
            <p className="error-text">{error}</p>
            <Link className="button secondary" to="/login">
              로그인으로 돌아가기
            </Link>
          </>
        ) : (
          <p>로그인 처리 중...</p>
        )}
      </div>
    </div>
  );
}
