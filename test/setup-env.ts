import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// AppModule을 import하기 전에 도는 파일 (jest-e2e.json setupFiles).

const DEFAULT_E2E_DATABASE_URL =
  "postgresql://cheers:password@localhost:55432/cheers_e2e";

// ConfigModule은 현재 디렉터리의 .env를 읽으므로, .env가 없는 test/로 옮겨서
// 개발자의 .env에 있는 실제 AWS · 메일 · Solapi 값이 테스트로 들어오지 못하게 함
if (existsSync(join(__dirname, ".env"))) {
  throw new Error("test/.env must not exist: e2e must not load an env file.");
}
process.chdir(__dirname);

// 셸에서 export한 값도 쓰지 않도록 .env-template의 모든 키를 비움
const template = readFileSync(join(__dirname, "../.env-template"), "utf8");
for (const match of template.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)) {
  process.env[match[1]] = "";
}

// DATABASE_URL이 아니라 전용 변수만 봄 (셸이나 .env의 staging 주소를 쓰지 않도록)
const databaseUrl = process.env.E2E_DATABASE_URL ?? DEFAULT_E2E_DATABASE_URL;
const { hostname, pathname, search } = new URL(databaseUrl);
// 테스트마다 TRUNCATE하므로 로컬 일회용 DB가 아니면 시작하지 않음.
// pg는 ?host= 값을 URL의 호스트보다 우선하므로 쿼리 문자열도 받지 않음
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(hostname) ||
  !pathname.endsWith("_e2e") ||
  search !== ""
) {
  throw new Error(
    "E2E_DATABASE_URL must point to a local database whose name ends with _e2e, without a query string.",
  );
}

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: databaseUrl,
  GOOGLE_CLIENT_ID: "e2e-google-client-id",
  CORS_ALLOWED_ORIGINS: "http://localhost:5173",
  WEB_BASE_URL: "http://localhost:5173",
  SLACK_WEBHOOK_URL: "http://127.0.0.1:9/e2e-slack",
  ACCESS_TOKEN_EXPIRES_IN: "1h",
  REFRESH_TOKEN_EXPIRE_DAYS: "30",
  WITHDRAWAL_GRACE_DAYS: "30",
  CHEERS_RANDOM_SEED_MINUTES: "60",
  SWAGGER_ENABLED: "false",
  // S3Client.send는 가짜로 대체(test/support/fake-s3.ts). 혹시 빠져나가도 AWS에 닿지 않도록 주소 · 자격증명도 더미
  AWS_S3_REGION: "ap-northeast-2",
  AWS_S3_BUCKET_NAME: "cheers-e2e-dummy-bucket",
  AWS_ENDPOINT_URL_S3: "http://127.0.0.1:9",
  AWS_ACCESS_KEY_ID: "e2e-dummy-access-key",
  AWS_SECRET_ACCESS_KEY: "e2e-dummy-secret-key",
  AWS_EC2_METADATA_DISABLED: "true",
  S3_PRESIGNED_URL_EXPIRES_IN: "600",
  S3_UPLOAD_URL_EXPIRES_IN: "300",
});
delete process.env.AWS_SESSION_TOKEN;
delete process.env.AWS_PROFILE;
