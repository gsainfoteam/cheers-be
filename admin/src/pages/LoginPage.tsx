import { useState } from "react";
import { buildIdpAuthorizeUrl } from "../lib/auth";

export function LoginPage() {
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>Cheers Admin</h1>
        <p>Infoteam 계정으로 로그인하세요.</p>
        {error && <p className="error-text">{error}</p>}
        <button
          className="button"
          onClick={() => {
            setError(null);
            buildIdpAuthorizeUrl()
              .then((url) => {
                window.location.href = url;
              })
              .catch(() =>
                setError(
                  "로그인을 시작하지 못했습니다. HTTPS 주소로 접속했는지 확인하고 다시 시도해 주세요.",
                ),
              );
          }}
        >
          Infoteam 계정으로 로그인
        </button>
      </div>
    </div>
  );
}
