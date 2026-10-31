import { buildIdpAuthorizeUrl } from "../lib/auth";

export function LoginPage() {
  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>Cheers Admin</h1>
        <p>Infoteam 계정으로 로그인하세요.</p>
        <button
          className="button"
          onClick={() => {
            window.location.href = buildIdpAuthorizeUrl();
          }}
        >
          Infoteam 계정으로 로그인
        </button>
      </div>
    </div>
  );
}
