// 배포된 서버(기본 staging)에 대한 스모크 테스트. 코드 버그가 아니라 "배포 · 설정이 맞는지"를 본다
// (env 누락, DB 권한, 마이그레이션, 메일, 알림톡, S3, IdP 연결 등). CI의 e2e와는 별개
//
// 어드민 1명(IdP)과 Google 계정 2개(재학생 · 현업자)로 가입부터 커피챗 연락처 공유까지 진행하고, 어드민 화면에서 결과를 확인한다
//   1) 어드민: IdP 로그인 → 회사 등록(다른 표기 · 로고 포함)
//   2) 재학생 가입 (약관 → 학교 메일 인증 → 추가 정보 → 파일 첨부)
//   3) 현업자 가입 (약관 → 명함 업로드 · 인증 → 회사 직접 입력으로 가입 → 어드민 검토 목록 확인
//      → 회사 검색으로 1)의 회사를 골라 수정 → 직접 입력한 회사 삭제)
//   4) 알림 방식 설정: 가입 때는 메일만 켜 두고, 마이페이지 수정(POST /info)으로 두 계정의 알림톡을 켬 (PHONE이 있을 때)
//   5) 재학생: 현업자 목록(비공개 정보 미노출 · 회사 · 로고 확인) → 커피챗 요청 → 보낸 요청(공유 전: 현업자 연락처 없음)
//   6) 현업자: 받은 요청 확인 → 연락처 공유
//   7) 재학생: 보낸 요청(공유 후: 상태 contact_shared + 현업자 연락처 보임)
//   8) 어드민: 커피챗 요청 · 알림 발송 결과(메일 · 알림톡 notification_log) · 명함 열람 확인
//      PHONE이 있으면 알림톡 기록이 없거나 sent가 아니면 실패. 휴대폰에서 받은 알림톡 버튼이 신청 상세로 열리는지도 물어봄
//   9) 토큰 갱신 · 로그아웃
//  10) 정리: 두 계정 완전탈퇴(superadmin + DEV_USER_DELETE_ENABLED) → 회사 삭제
//      완전탈퇴를 쓸 수 없으면 탈퇴 요청(유예기간 뒤 삭제)으로 대신하고, 현업자가 고른 회사는 남김
//      중간 단계가 실패해도 정리는 함 (KEEP_DATA=1이면 정리하지 않음)
//
// macOS · Linux · Windows 공통 (bun만 있으면 됨)
//   bun run smoke:staging
// Google · IdP 로그인은 계정마다 한 번 브라우저에서 한다. redirect URI의 포트에 잠깐 서버를 띄워 결과를 받으므로
// 그 포트가 비어 있어야 한다 (admin 개발 서버가 5173 · 5174를 쓰고 있으면 끄거나 redirect URI를 바꿀 것)
//
// 환경변수 (셸 환경변수가 .env보다 우선. ENV_FILE로 다른 파일 지정 가능)
//   BASE_URL              대상 서버 (기본 https://api.stg.cheers.gistory.me)
//   GOOGLE_CLIENT_ID      웹 client ID. 서버 GOOGLE_CLIENT_ID와 같아야 함 (필수)
//   REDIRECT_URI          Google 콘솔에 등록한 localhost redirect URI (기본 http://localhost:5173)
//   IDP_CLIENT_ID         대상 서버의 IDP_CLIENT_ID와 같은 값 (MANAGER_TOKEN이 없으면 필수)
//   IDP_AUTHORIZE_URL     IdP 로그인 페이지 (기본 https://account.gistory.me/authorize)
//   MANAGER_REDIRECT_URI  IdP client에 등록한 localhost redirect URI (기본 http://localhost:5174/admin/callback)
//   MANAGER_TOKEN         어드민 토큰을 직접 지정하면 IdP 로그인을 건너뜀
//                         (어드민 화면 로그인 후 localStorage의 cheers_admin_access_token 값, 유효기간 1일)
//   SCHOOL_EMAIL          재학생 메일 인증에 쓸 학교 메일. 비우면 필요할 때 물어봄
//   PHONE                 휴대폰 번호(01012345678)를 주면 가입 후 두 계정의 알림 방식에 알림톡을 켜서 그 번호로 실제 알림톡을 보냄
//                         (요청 알림은 현업자, 연락처 공유 알림은 재학생에게 가므로 이 번호로 2건이 옴)
//   KEEP_DATA=1           마지막 정리를 하지 않음 (어드민 화면에서 직접 보고 싶을 때)
//
// 이미 진행한 단계는 건너뜀: 정리 전에 멈춰 계정이 남았으면, 서버가 알려 주는 next_step을 보고 이어서 진행함
// 현업자 · 재학생에게 실제 알림 메일이 나감. 로그에는 토큰 · 비밀 값을 출력하지 않는다
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomInt } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createInterface } from "node:readline/promises";
import * as dotenv from "dotenv";

dotenv.config({ quiet: true, path: process.env.ENV_FILE });

type UserKind = "student" | "graduated";
type Auth = { access: string };
type Account = Auth & { refresh: string; id: string; label: string };
type Manager = Auth & { role: string };
type Company = { id: number; name: string; alias: string };
// 응답 본문을 스모크 테스트 안에서만 읽으므로 형식을 따로 정의하지 않음
type Res = { code: number; text: string; json: any };

// 정리할 대상. 중간에 실패해도 여기까지 만든 것만 정리함
type State = {
  manager: Manager | null;
  hardDelete: boolean;
  accounts: Account[];
  companies: number[];
};

// GOOGLE_CLIENT_ID는 서버 설정처럼 쉼표로 여러 개일 수 있으므로 첫 번째(웹 client)를 씀
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID ?? "").split(",")[0];
const BASE_URL = (
  process.env.BASE_URL || "https://api.stg.cheers.gistory.me"
).replace(/\/$/, "");
const REDIRECT_URI = process.env.REDIRECT_URI || "http://localhost:5173";
const IDP_CLIENT_ID = process.env.IDP_CLIENT_ID ?? "";
const IDP_AUTHORIZE_URL =
  process.env.IDP_AUTHORIZE_URL || "https://account.gistory.me/authorize";
const MANAGER_REDIRECT_URI =
  process.env.MANAGER_REDIRECT_URI || "http://localhost:5174/admin/callback";
const MANAGER_TOKEN = process.env.MANAGER_TOKEN ?? "";
const PHONE = process.env.PHONE ?? "";
const KEEP_DATA = process.env.KEEP_DATA === "1";
const TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const NOTIFICATION_WAIT_MS = 30_000;
const OK = [200, 201];
const MANAGER = "/api/manager/v1";

// 서버가 업로드 파일의 시그니처(magic number)를 확인하므로 형식에 맞는 최소 파일을 씀
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const MINIMAL_PDF = Buffer.from("%PDF-1.4\n%%EOF\n");

let pass = 0;
let fail = 0;
let warnings = 0;

// must가 실패하면 던짐. main에서 받아 정리 후 요약
class Abort extends Error {}

const color = (code: number, text: string) => `\x1b[${code}m${text}\x1b[0m`;
const green = (text: string) => console.log(color(32, text));
const red = (text: string) => console.log(color(31, text));
const step = (text: string) => console.log(`\n${color(1, `== ${text}`)}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function summary(): never {
  console.log("\n────────────────────────────");
  const line = `통과 ${pass} / 실패 ${fail} / 경고 ${warnings}`;
  if (fail === 0) green(line);
  else red(line);
  process.exit(fail === 0 ? 0 : 1);
}

// 실패 시 응답 본문은 에러 메시지뿐이라 출력해도 안전하지만, 길이는 제한
function failed(name: string, detail?: string): false {
  fail += 1;
  red(`  ✗ ${name}`);
  if (detail) console.log(`    ${detail.slice(0, 300)}`);
  return false;
}

// 실패는 아니지만 확인하지 못한 것 (설정상 꺼져 있는 기능 등)
function warn(text: string): void {
  warnings += 1;
  console.log(color(33, `  ! ${text}`));
}

function check(name: string, res: Res, expect: number | number[]): boolean {
  const allowed = Array.isArray(expect) ? expect : [expect];
  if (allowed.includes(res.code)) {
    pass += 1;
    green(`  ✓ ${name} (${res.code})`);
    return true;
  }
  return failed(
    `${name} (HTTP ${res.code}, 기대 ${allowed.join("|")})`,
    res.text,
  );
}

function assert(name: string, condition: boolean, detail?: string): boolean {
  if (condition) {
    pass += 1;
    green(`  ✓ ${name}`);
    return true;
  }
  return failed(name, detail);
}

// 실패하면 이후 단계가 의미 없으므로 정리 단계로 넘어감
function must(name: string, res: Res, expect: number | number[]): void {
  if (!check(name, res, expect)) throw new Abort();
}
function mustAssert(name: string, condition: boolean, detail?: string): void {
  if (!assert(name, condition, detail)) throw new Abort();
}

async function send(url: string, init: RequestInit): Promise<Res> {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // S3 응답 등 JSON이 아닌 본문은 text로만 봄
    }
    return { code: response.status, text, json };
  } catch (error) {
    return { code: 0, text: String(error), json: null };
  }
}

function req(
  method: string,
  path: string,
  auth?: Auth | null,
  body?: unknown,
): Promise<Res> {
  const headers: Record<string, string> = {};
  if (auth) headers.Authorization = `Bearer ${auth.access}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return send(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

function openBrowser(url: string): void {
  // cmd의 start는 URL의 &를 명령 구분자로 읽으므로 Windows는 rundll32를 씀
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  // 열지 못해도 출력된 주소를 직접 열면 되므로 오류는 무시
  spawn(command as string, args as string[], {
    stdio: "ignore",
    detached: true,
  })
    .on("error", () => undefined)
    .unref();
}

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><body>완료. 이 탭을 닫고 터미널로 돌아가세요.`;

// Google은 ID token을 주소의 # 뒤에 담아 보내고 #는 서버로 오지 않으므로, 페이지 스크립트가 다시 보내 줌
const GOOGLE_CALLBACK_PAGE = `<!doctype html><meta charset="utf-8"><body>처리 중…<script>
fetch("/__smoke_callback",{method:"POST",body:location.hash.slice(1)})
  .then(()=>{document.body.textContent="완료. 이 탭을 닫고 터미널로 돌아가세요."})
  .catch(()=>{document.body.textContent="실패. 터미널을 확인하세요."});
</script>`;

// 요청 하나를 읽어 로그인 결과면 파라미터를, 아니면 null(계속 기다림)을 돌려줌. 응답은 직접 끝냄
type CallbackReader = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<URLSearchParams | null>;

// redirect URI의 포트에 서버를 띄워 로그인 결과를 받음
function receiveCallback(
  redirectUri: string,
  authUrl: string,
  read: CallbackReader,
): Promise<URLSearchParams> {
  const { port, hostname } = new URL(redirectUri);
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      read(request, response).then(
        (params) => {
          if (params) finish(() => resolve(params));
        },
        () => {
          response.statusCode = 400;
          response.end();
        },
      );
    });
    const timer = setTimeout(
      () => finish(() => reject(new Error("로그인 대기 시간 초과"))),
      LOGIN_TIMEOUT_MS,
    );
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      server.close();
      server.closeAllConnections();
      settle();
    };
    server.on("error", (error) =>
      finish(() =>
        reject(new Error(`${redirectUri}에서 대기할 수 없음: ${error}`)),
      ),
    );
    server.listen(Number(port) || 80, hostname, () => openBrowser(authUrl));
  });
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => resolve(raw));
    request.on("error", reject);
  });
}

const readGoogleCallback =
  (state: string): CallbackReader =>
  async (request, response) => {
    if (request.method !== "POST") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(GOOGLE_CALLBACK_PAGE);
      return null;
    }
    const params = new URLSearchParams(await readBody(request));
    // state가 다르면 이 로그인의 응답이 아니므로 무시하고 계속 기다림
    const matched = params.get("state") === state;
    response.statusCode = matched ? 200 : 400;
    response.end();
    return matched ? params : null;
  };

// IdP는 code를 query로 보냄. 콜백 경로가 아닌 요청(favicon 등)은 무시
const readIdpCallback: CallbackReader = async (request, response) => {
  const url = new URL(request.url ?? "/", MANAGER_REDIRECT_URI);
  const isCallback =
    url.pathname === new URL(MANAGER_REDIRECT_URI).pathname &&
    (url.searchParams.has("code") || url.searchParams.has("error"));
  if (!isCallback) {
    response.statusCode = 404;
    response.end();
    return null;
  }
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(DONE_PAGE);
  return url.searchParams;
};

const base64Url = (bytes: Buffer) => bytes.toString("base64url");

// 어드민 화면(admin/src/lib/auth.ts)과 같은 PKCE 흐름. MANAGER_TOKEN이 있으면 건너뜀
async function managerLogin(): Promise<Manager> {
  let token = MANAGER_TOKEN;
  if (token) {
    console.log("  MANAGER_TOKEN을 씀 (IdP 로그인 건너뜀)");
  } else {
    const codeVerifier = base64Url(randomBytes(32));
    const authUrl = `${IDP_AUTHORIZE_URL}?${new URLSearchParams({
      response_type: "code",
      client_id: IDP_CLIENT_ID,
      redirect_uri: MANAGER_REDIRECT_URI,
      scope: "email",
      code_challenge: base64Url(
        createHash("sha256").update(codeVerifier).digest(),
      ),
      code_challenge_method: "S256",
    })}`;
    console.log(
      "[어드민] 브라우저에서 admin_account에 등록된 계정으로 IdP 로그인하세요. 열리지 않으면 아래 주소를 직접 여세요.",
    );
    console.log(authUrl);

    let code: string | null;
    try {
      const params = await receiveCallback(
        MANAGER_REDIRECT_URI,
        authUrl,
        readIdpCallback,
      );
      code = params.get("code");
      if (!code) throw new Error(`IdP 로그인 실패: ${params.get("error")}`);
    } catch (error) {
      failed("IdP 로그인", String(error));
      throw new Abort();
    }

    const login = await req("POST", `${MANAGER}/auth/login`, null, {
      code,
      redirect_uri: MANAGER_REDIRECT_URI,
      code_verifier: codeVerifier,
    });
    must("POST /manager/auth/login", login, OK);
    token = login.json.access_token;
  }

  const me = await req("GET", `${MANAGER}/auth/me`, { access: token });
  must("GET /manager/auth/me", me, 200);
  console.log(`    role=${me.json.role}`);
  return { access: token, role: me.json.role };
}

// 완전탈퇴 API를 쓸 수 있으면 true. superadmin이 아니거나(403) 꺼진 환경(404)이면 false
async function checkHardDelete(manager: Manager): Promise<boolean> {
  const res = await req("GET", `${MANAGER}/dev/user?page=1&size=1`, manager);
  if (res.code === 403 || res.code === 404) {
    warn(
      `완전탈퇴를 쓸 수 없음 (HTTP ${res.code}: superadmin이 아니거나 DEV_USER_DELETE_ENABLED가 꺼짐). 정리는 탈퇴 요청으로 대신함`,
    );
    return false;
  }
  return check("GET /manager/dev/user (완전탈퇴 사용 가능)", res, 200);
}

// presigned PUT으로 파일을 올리고 key를 돌려줌. 실패하면 null
async function uploadFile(
  path: string,
  auth: Auth,
  contentType: string,
  file: Buffer,
): Promise<string | null> {
  const issued = await req("POST", path, auth, {
    content_type: contentType,
    size: file.length,
  });
  if (!check(`POST ${path}`, issued, OK)) return null;
  const put = await send(issued.json.url, {
    method: "PUT",
    headers: { "Content-Type": contentType, ...issued.json.headers },
    body: new Uint8Array(file),
  });
  return check("PUT presigned URL (S3)", put, 200) ? issued.json.key : null;
}

// 현업자가 검색해서 고를 회사. 다른 표기로 검색되는지 보려고 표기를 하나 더 등록
async function createCompany(
  manager: Manager,
  state: State,
  suffix: string,
): Promise<Company> {
  const company = { name: `스모크회사${suffix}`, alias: `smokeco${suffix}` };
  const created = await req("POST", `${MANAGER}/company`, manager, {
    name: company.name,
    names: [company.alias],
  });
  must("POST /manager/company (다른 표기 포함)", created, OK);
  const id: number = created.json.company_id;
  state.companies.push(id);
  assert(
    "등록한 표기가 있음",
    created.json.names?.some((n: { name: string }) => n.name === company.alias),
    created.text,
  );

  console.log("\n  회사 로고 업로드 (S3 업로드 · 확정)");
  const key = await uploadFile(
    `${MANAGER}/company/logo/upload-url`,
    manager,
    "image/png",
    PNG_1X1,
  );
  if (key) {
    check(
      "PUT /manager/company/{id}/logo",
      await req("PUT", `${MANAGER}/company/${id}/logo`, manager, { key }),
      200,
    );
  }

  const search = await req(
    "GET",
    `${MANAGER}/company/search?q=${encodeURIComponent(company.alias)}`,
    manager,
  );
  check("GET /manager/company/search (다른 표기로 검색)", search, 200);
  const found = (search.json ?? []).find(
    (item: { company_id: number }) => item.company_id === id,
  );
  assert("검색 결과에 회사가 있음", Boolean(found), search.text);
  if (key) assert("검색 결과에 로고가 있음", Boolean(found?.logo_url));
  return { id, ...company };
}

// 로그인 후 내 정보까지 확인하고 토큰을 돌려줌
async function googleLogin(
  label: string,
  type: UserKind,
  state: State,
): Promise<Account> {
  const nonce = randomBytes(16).toString("hex");
  const oauthState = randomBytes(16).toString("hex");
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams(
    {
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "id_token",
      scope: "openid email profile",
      nonce: createHash("sha256").update(nonce).digest("hex"),
      state: oauthState,
      prompt: "select_account",
    },
  )}`;
  console.log(
    `[${label}] 브라우저에서 ${label} 계정으로 로그인하세요. 열리지 않으면 아래 주소를 직접 여세요.`,
  );
  console.log(authUrl);

  let token: string | null;
  try {
    const params = await receiveCallback(
      REDIRECT_URI,
      authUrl,
      readGoogleCallback(oauthState),
    );
    token = params.get("id_token");
    if (!token) throw new Error(`Google 로그인 실패: ${params.get("error")}`);
  } catch (error) {
    failed(`Google 로그인 (${label})`, String(error));
    throw new Abort();
  }

  const login = await req("POST", "/api/v1/user/oauth/login", null, {
    provider: "google",
    type,
    token,
    nonce,
  });
  must(`POST /user/oauth/login (${label})`, login, OK);
  mustAssert("응답에 토큰이 있음", Boolean(login.json?.access_token));
  const session = { access: login.json.access_token };

  const info = await req("GET", "/api/v1/user/info", session);
  must(`GET /user/info (${label})`, info, 200);
  console.log(
    `    status=${info.json.status} next_step=${info.json.next_step} type=${info.json.type}`,
  );
  // 가입을 마친 계정은 로그인 때 보낸 유형을 무시함 → 다른 유형으로 가입한 계정이면 흐름이 맞지 않음
  mustAssert(
    `${type} 계정임 (이미 다른 유형으로 가입한 계정이면 실패)`,
    info.json.type === type,
  );
  const account: Account = {
    ...session,
    refresh: login.json.refresh_token,
    id: info.json.id,
    label,
  };
  state.accounts.push(account);
  return account;
}

async function doConsent(account: Account): Promise<void> {
  const list = await req("GET", "/api/v1/user/consent/list", account);
  must("GET /user/consent/list", list, 200);
  const consents: {
    type: string;
    version: string;
    is_required: boolean;
    agreed: boolean;
  }[] = list.json.consents;
  console.log(
    `    약관 ${consents.length}건: ${consents
      .map(
        (c) => `${c.type}@${c.version}(필수=${c.is_required},동의=${c.agreed})`,
      )
      .join(", ")}`,
  );
  mustAssert(
    "약관 데이터가 있음 (마이그레이션 적용 확인)",
    consents.length > 0,
  );

  const info = await req("GET", "/api/v1/user/info", account);
  if (info.json.next_step !== "consent") {
    console.log(`  - 이미 동의함 (next_step=${info.json.next_step}), 건너뜀`);
    return;
  }
  const agree = await req("POST", "/api/v1/user/consent", account, {
    consents: consents.map(({ type, version }) => ({
      type,
      version,
      agreed: true,
    })),
  });
  must("POST /user/consent (전체 동의)", agree, OK);
}

// 가입이 이번 호출로 끝나면 새 토큰이 오므로 계정에 반영
function applySignupTokens(account: Account, res: Res): void {
  if (!res.json?.access_token) return;
  account.access = res.json.access_token;
  account.refresh = res.json.refresh_token;
}

// 가입 때는 메일만 켬. 알림톡은 가입 후 알림 방식 설정(enableAlimtalk)에서 켬
const contactOf = (email: string) => ({
  email_enabled: true,
  kakao_enabled: false,
  email,
  phone: null,
});

// POST /info 본문 (가입 후에는 마이페이지 수정). 알림 방식 설정에서 연락 설정만 바꿔 다시 보냄
type ProfileBody = { contact: ReturnType<typeof contactOf> } & Record<
  string,
  unknown
>;

async function studentSignup(account: Account): Promise<ProfileBody> {
  await doConsent(account);

  let info = await req("GET", "/api/v1/user/info", account);
  let schoolEmail = process.env.SCHOOL_EMAIL ?? "";
  if (info.json.next_step === "verify") {
    console.log("\n  재학생 메일 인증 (실제 메일 발송 · SMTP 확인)");
    if (!schoolEmail) {
      schoolEmail = await ask("  학교 메일 주소 (예: id@gm.gist.ac.kr): ");
    }
    const sent = await req(
      "POST",
      "/api/v1/user/student/verify/send-code",
      account,
      { email: schoolEmail },
    );
    // 메일을 보낸 뒤에 응답하므로, 발송이 실패하면 502로 바로 알 수 있음
    if (sent.code === 502) {
      console.log("    인증 메일 발송 실패: 서버의 SMTP 설정을 확인하세요");
    }
    must("POST /student/verify/send-code", sent, OK);
    const code = await ask("  메일함으로 온 6자리 코드: ");
    must(
      "POST /student/verify/code",
      await req("POST", "/api/v1/user/student/verify/code", account, { code }),
      OK,
    );
  } else {
    console.log(`  - 메일 인증 건너뜀 (next_step=${info.json.next_step})`);
  }

  const departments = await req(
    "GET",
    "/api/v1/user/student/departments",
    account,
  );
  must("GET /student/departments", departments, 200);
  mustAssert(
    "학과 데이터가 있음 (시드 데이터 확인)",
    departments.json.departments?.length > 0,
  );
  const departmentId: number = departments.json.departments[0].id;
  console.log(
    `    학과 ${departments.json.departments.length}개, 첫 학과 id=${departmentId}`,
  );

  const interests = await req("GET", "/api/v1/user/student/interests", account);
  must("GET /student/interests", interests, 200);
  mustAssert(
    "관심 분야 데이터가 있음 (시드 데이터 확인)",
    interests.json.interests?.length > 0,
  );
  console.log(`    관심 분야 ${interests.json.interests.length}개`);

  info = await req("GET", "/api/v1/user/info", account);
  // 연락용 메일: 방금 인증한 학교 메일, 없으면 서버에 저장된 값 (재실행 시)
  const contactEmail: string =
    schoolEmail || info.json.student?.email || info.json.email;
  const profile: ProfileBody = {
    name: info.json.name || "스모크재학생",
    department_id: departmentId,
    interests: [interests.json.interests[0]],
    activities: ["배포 확인"],
    contact: contactOf(contactEmail),
  };
  const linkAttachment = {
    kind: "portfolio",
    source: "link",
    url: "https://example.com",
  };
  if (info.json.next_step === "profile") {
    const saved = await req("POST", "/api/v1/user/student/info", account, {
      ...profile,
      attachments: [linkAttachment],
    });
    must("POST /student/info (가입 완료)", saved, OK);
    applySignupTokens(account, saved);
  } else {
    console.log(`  - 추가 정보 건너뜀 (next_step=${info.json.next_step})`);
  }

  info = await req("GET", "/api/v1/user/info", account);
  must("GET /user/info (가입 후)", info, 200);
  mustAssert("재학생 status=active", info.json.status === "active");

  // 파일 첨부는 가입을 마친 재학생만 가능. 저장 후 presigned GET으로 내려받아 S3 읽기까지 확인
  console.log("\n  이력서 파일 첨부 (S3 업로드 · 저장 · 조회)");
  const key = await uploadFile(
    "/api/v1/file/attachment/upload-url",
    account,
    "application/pdf",
    MINIMAL_PDF,
  );
  if (!key) return profile;
  const savedFile = await req("POST", "/api/v1/user/student/info", account, {
    ...profile,
    attachments: [
      linkAttachment,
      { kind: "cv", source: "file", key, file_name: "smoke.pdf" },
    ],
  });
  if (!check("POST /student/info (파일 첨부 저장)", savedFile, OK)) {
    return profile;
  }
  info = await req("GET", "/api/v1/user/info", account);
  const attachment = info.json.student?.profile?.attachments?.find(
    (a: { source: string }) => a.source === "file",
  );
  if (!assert("내 정보에 파일 첨부가 있음", Boolean(attachment), info.text)) {
    return profile;
  }
  check(
    "첨부 파일 내려받기 (presigned GET)",
    await send(attachment.url, { method: "GET" }),
    200,
  );
  return profile;
}

// 직접 입력한 회사가 어드민 검토 목록에 올라왔는지 보고 정리 대상에 넣음
async function checkPendingCompany(
  manager: Manager,
  state: State,
  name: string,
): Promise<void> {
  const list = await req(
    "GET",
    `${MANAGER}/company?q=${encodeURIComponent(name)}`,
    manager,
  );
  check("GET /manager/company (직접 입력한 회사)", list, 200);
  const pending = (list.json?.items ?? []).find(
    (item: { name: string }) => item.name === name,
  );
  if (!assert("직접 입력한 회사가 등록됨", Boolean(pending), list.text)) {
    return;
  }
  state.companies.push(pending.company_id);
  assert("검토 필요(needs_review=true)", pending.needs_review === true);
  assert("고른 현업자 1명", pending.graduated_count === 1);
}

// 가입 완료 후 현업자 닉네임을 돌려줌
async function graduatedSignup(
  account: Account,
  manager: Manager,
  state: State,
  company: Company,
  suffix: string,
): Promise<{ nickname: string; body: ProfileBody }> {
  await doConsent(account);

  let info = await req("GET", "/api/v1/user/info", account);
  if (info.json.next_step === "verify") {
    console.log("\n  명함 업로드 · 인증 (S3 + 명함 확정)");
    const key = await uploadFile(
      "/api/v1/file/business-card/upload-url",
      account,
      "image/png",
      PNG_1X1,
    );
    if (!key) throw new Abort();
    must(
      "POST /graduated/verify/business-card",
      await req(
        "POST",
        "/api/v1/user/graduated/verify/business-card",
        account,
        {
          key,
        },
      ),
      OK,
    );
  } else {
    console.log(`  - 명함 인증 건너뜀 (next_step=${info.json.next_step})`);
  }

  info = await req("GET", "/api/v1/user/info", account);
  const contactEmail: string =
    info.json.graduated?.profile?.contact?.email ||
    info.json.email ||
    (await ask("  현업자 연락 메일: "));
  const profile: ProfileBody = {
    name: info.json.name || "스모크현업자",
    department: "플랫폼팀",
    job: "백엔드 개발자",
    hashtags: ["스모크", "배포확인"],
    links: ["https://example.com"],
    contact: contactOf(contactEmail),
  };
  if (info.json.next_step === "profile") {
    // 검색 결과에 없는 회사를 직접 입력해 가입 → 새 회사로 등록되어 어드민 검토를 기다림
    const directName = `스모크직접입력${suffix}`;
    const saved = await req("POST", "/api/v1/user/graduated/info", account, {
      ...profile,
      nickname: `스모크${randomInt(1000, 10000)}`,
      company_name: directName,
    });
    must("POST /graduated/info (가입 완료 · 회사 직접 입력)", saved, OK);
    applySignupTokens(account, saved);
    await checkPendingCompany(manager, state, directName);
  } else {
    console.log(`  - 추가 정보 건너뜀 (next_step=${info.json.next_step})`);
  }

  info = await req("GET", "/api/v1/user/info", account);
  must("GET /user/info (가입 후)", info, 200);
  mustAssert("현업자 status=active", info.json.status === "active");

  console.log("\n  회사 검색 · 선택 (마이페이지 수정)");
  const search = await req(
    "GET",
    `/api/v1/company?q=${encodeURIComponent(company.alias)}`,
    account,
  );
  must("GET /company (다른 표기로 검색)", search, 200);
  const found = (search.json ?? []).find(
    (item: { company_id: number }) => item.company_id === company.id,
  );
  mustAssert(
    "검색 결과에 어드민이 등록한 회사가 있음",
    Boolean(found),
    search.text,
  );
  assert(
    "회사 이름과 맞은 표기가 따로 옴",
    found.name === company.name && found.matched_name === company.alias,
    JSON.stringify(found),
  );
  must(
    "POST /graduated/info (company_id로 수정)",
    await req("POST", "/api/v1/user/graduated/info", account, {
      ...profile,
      company_id: company.id,
    }),
    OK,
  );
  info = await req("GET", "/api/v1/user/info", account);
  const saved = info.json.graduated?.profile;
  assert(
    "내 정보의 회사가 고른 회사로 바뀜",
    saved?.company_id === company.id && saved?.company === company.name,
    JSON.stringify(saved),
  );

  // 직접 입력한 회사는 이제 아무도 고르지 않았으므로 지울 수 있음
  const pendingId = state.companies.find((id) => id !== company.id);
  if (pendingId !== undefined) {
    const removed = check(
      "DELETE /manager/company/{id} (직접 입력한 회사)",
      await req("DELETE", `${MANAGER}/company/${pendingId}`, manager),
      200,
    );
    if (removed) {
      state.companies = state.companies.filter((id) => id !== pendingId);
    }
  }

  const nickname: string = saved?.nickname ?? "";
  mustAssert("닉네임이 있음", nickname !== "");
  console.log(`    현업자 닉네임: ${nickname}`);
  return { nickname, body: { ...profile, company_id: company.id } };
}

// 마이페이지에서 알림 방식에 알림톡을 켜는 흐름. 메일은 켠 채로 두고 PHONE을 연락 번호로 저장
async function enableAlimtalk(
  account: Account,
  kind: UserKind,
  body: ProfileBody,
): Promise<void> {
  // 재학생 첨부는 저장된 값으로 다시 보냄 (올릴 때의 tmp key는 저장하면서 최종 key로 바뀌어 다시 쓸 수 없음)
  let attachments: unknown;
  if (kind === "student") {
    const current = await req("GET", "/api/v1/user/info", account);
    attachments = (current.json?.student?.profile?.attachments ?? []).map(
      (a: {
        kind: string;
        source: string;
        url: string;
        key: string | null;
        file_name: string | null;
      }) =>
        a.source === "file"
          ? {
              kind: a.kind,
              source: a.source,
              key: a.key,
              file_name: a.file_name,
            }
          : { kind: a.kind, source: a.source, url: a.url },
    );
  }
  const saved = await req("POST", `/api/v1/user/${kind}/info`, account, {
    ...body,
    ...(attachments === undefined ? {} : { attachments }),
    contact: { ...body.contact, kakao_enabled: true, phone: PHONE },
  });
  if (!check(`POST /${kind}/info (${account.label} 알림톡 켜기)`, saved, OK)) {
    return;
  }
  const info = await req("GET", "/api/v1/user/info", account);
  const contact = info.json?.[kind]?.profile?.contact;
  assert(
    `${account.label} 연락 설정: 메일 · 알림톡 둘 다 켜짐`,
    contact?.email_enabled === true && contact?.kakao_enabled === true,
    JSON.stringify(contact),
  );
  assert(
    `${account.label} 연락 설정: 알림톡 번호가 PHONE으로 저장됨`,
    contact?.phone === PHONE,
  );
}

const hasNoKeys = (value: object, keys: string[]) =>
  keys.every((key) => !(key in value));
const hasRequest = (res: Res, id: string) =>
  (res.json?.items ?? []).some((item: { id: string }) => item.id === id);

async function requestCoffeeChat(
  student: Account,
  nickname: string,
  company: Company,
): Promise<string> {
  const list = await req(
    "GET",
    "/api/v1/cheers?page=1&size=50&sort=recent_joined",
    student,
  );
  must("GET /cheers (현업자 목록)", list, 200);
  console.log(`    현업자 total=${list.json.total}`);
  const card = list.json.items?.find(
    (item: { nickname: string }) => item.nickname === nickname,
  );
  mustAssert(`목록에 방금 가입한 현업자(${nickname})가 있음`, Boolean(card));
  assert(
    "목록 카드에 이름 · 부서 · 연락처가 없음 (비공개)",
    hasNoKeys(card, ["name", "department", "email", "phone"]),
    JSON.stringify(card),
  );
  assert("can_request=true (연락 수단을 켠 현업자)", card.can_request === true);
  assert(
    "목록 카드의 회사가 고른 회사 이름",
    card.company === company.name,
    JSON.stringify(card),
  );
  if (card.company_logo_url) {
    check(
      "회사 로고 내려받기 (presigned GET)",
      await send(card.company_logo_url, { method: "GET" }),
      200,
    );
  } else {
    failed("목록 카드에 회사 로고가 있음", JSON.stringify(card));
  }

  const created = await req("POST", "/api/v1/cheers/request", student, {
    graduated_id: card.graduated_id,
    message: "스모크 테스트 커피챗 요청입니다 (자동 생성)",
  });
  must("POST /cheers/request", created, OK);
  const requestId: string = created.json?.id;
  mustAssert("요청 id 수령", Boolean(requestId));

  const detail = await req("GET", `/api/v1/cheers/sent/${requestId}`, student);
  must("GET /cheers/sent/{id} (공유 전)", detail, 200);
  assert("공유 전 status=requested", detail.json.status === "requested");
  assert(
    "공유 전 현업자 연락처 없음 (shared_contact=null)",
    detail.json.shared_contact === null,
  );
  assert(
    "공유 전 현업자 정보에 이름 · 연락처가 없음",
    hasNoKeys(detail.json.graduated, ["name", "email", "phone"]),
  );

  const sent = await req("GET", "/api/v1/cheers/sent?page=1&size=20", student);
  must("GET /cheers/sent (보낸 요청 목록)", sent, 200);
  assert("보낸 요청 목록에 방금 요청이 있음", hasRequest(sent, requestId));
  return requestId;
}

// 연락처를 공유했으면 true
async function shareContact(
  graduated: Account,
  requestId: string,
): Promise<boolean> {
  const received = await req(
    "GET",
    "/api/v1/cheers/received?page=1&size=20",
    graduated,
  );
  check("GET /cheers/received (받은 요청 목록)", received, 200);
  assert("받은 요청 목록에 방금 요청이 있음", hasRequest(received, requestId));

  const path = `/api/v1/cheers/received/${requestId}`;
  check(
    "GET /cheers/received/{id} (상세 · 첫 열람 기록)",
    await req("GET", path, graduated),
    200,
  );

  const shared = check(
    "POST /cheers/received/{id}/share-contact (연락처 공유)",
    await req("POST", `${path}/share-contact`, graduated),
    200,
  );
  // 같은 요청에 두 번 눌러도 처음 결과를 돌려줌
  check(
    "연락처 공유 재요청도 오류 없이 처리",
    await req("POST", `${path}/share-contact`, graduated),
    200,
  );
  return shared;
}

async function confirmShared(
  student: Account,
  requestId: string,
  shared: boolean,
): Promise<void> {
  const detail = await req("GET", `/api/v1/cheers/sent/${requestId}`, student);
  must("GET /cheers/sent/{id} (공유 후)", detail, 200);
  if (!shared) {
    failed("연락처 공유가 실패해 공유 후 상태를 확인할 수 없음");
    return;
  }
  const contact = detail.json.shared_contact;
  assert(
    "공유 후 status=contact_shared",
    detail.json.status === "contact_shared",
  );
  assert("공유 후 현업자 연락처가 보임 (이메일)", Boolean(contact?.email));
  assert("공유 후 현업자 이름이 보임", Boolean(contact?.name));
  assert("공유 시각(shared_at)이 있음", Boolean(contact?.shared_at));
}

type NotificationLog = {
  event: string;
  channel: string;
  status: string;
  error: string | null;
  attempt: number;
  next_retry_at: string | null;
};

const EVENTS = ["coffee_chat_requested", "contact_shared"];
// PHONE이 있으면 알림톡도 켰으므로 두 채널을 다 확인
const CHANNELS = PHONE ? ["email", "kakao_alimtalk"] : ["email"];

// 알림은 응답 뒤에 비동기로 나가므로 두 이벤트의 기록(메일, PHONE이 있으면 알림톡도)이 생길 때까지 기다린 뒤 상세를 돌려줌
async function waitForNotifications(
  manager: Manager,
  requestId: string,
): Promise<Res> {
  const path = `${MANAGER}/coffee-chat/request/${requestId}`;
  const deadline = Date.now() + NOTIFICATION_WAIT_MS;
  for (;;) {
    const detail = await req("GET", path, manager);
    const logs: NotificationLog[] = detail.json?.notifications ?? [];
    const done = EVENTS.every((event) =>
      CHANNELS.every((channel) =>
        logs.some((log) => log.event === event && log.channel === channel),
      ),
    );
    if (detail.code !== 200 || done || Date.now() > deadline) return detail;
    await sleep(2000);
  }
}

function checkNotification(
  logs: NotificationLog[],
  event: string,
  channel: string,
): void {
  const log = logs.find((l) => l.event === event && l.channel === channel);
  const name = `알림 ${event} · ${channel}`;
  if (!log) {
    failed(
      `${name} 기록이 있음`,
      channel === "kakao_alimtalk"
        ? `${NOTIFICATION_WAIT_MS / 1000}초 기다림. 서버의 ALIGO_* · KAKAO_TEMPLATE_* · WEB_BASE_URL(https://) 중 비어 있으면 발송 없이 건너뛰어 기록이 남지 않음`
        : `${NOTIFICATION_WAIT_MS / 1000}초 기다림`,
    );
    return;
  }
  assert(
    `${name} status=sent`,
    log.status === "sent",
    `status=${log.status} attempt=${log.attempt} next_retry_at=${log.next_retry_at} error=${log.error}`,
  );
  assert(
    `${name}에 재시도 필드가 있음 (attempt · next_retry_at)`,
    typeof log.attempt === "number" && "next_retry_at" in log,
  );
}

// 어드민 화면에서 커피챗 결과 · 알림 발송 · 명함을 확인
async function checkManagerViews(
  manager: Manager,
  requestId: string,
  nickname: string,
): Promise<void> {
  const list = await req(
    "GET",
    `${MANAGER}/coffee-chat/request?graduated_nickname=${encodeURIComponent(nickname)}`,
    manager,
  );
  check("GET /manager/coffee-chat/request (닉네임 필터)", list, 200);
  const item = (list.json?.items ?? []).find(
    (i: { pk: string }) => i.pk === requestId,
  );
  assert("요청 목록에 방금 요청이 있음", Boolean(item), list.text);
  assert("요청 목록 status=contact_shared", item?.status === "contact_shared");

  console.log("\n  알림 발송 결과 (메일 · 알림톡, 최대 30초 기다림)");
  const detail = await waitForNotifications(manager, requestId);
  if (check("GET /manager/coffee-chat/request/{id}", detail, 200)) {
    const logs: NotificationLog[] = detail.json.notifications ?? [];
    for (const event of EVENTS) {
      for (const channel of CHANNELS) checkNotification(logs, event, channel);
    }
  }

  // 어드민 알림 발송 기록 목록 (채널 필터)에도 이번 요청의 기록이 보이는지
  for (const channel of CHANNELS) {
    const logs = await req(
      "GET",
      `${MANAGER}/coffee-chat/notification-log?channel=${channel}&page=1&size=20`,
      manager,
    );
    if (
      !check(
        `GET /manager/coffee-chat/notification-log (${channel})`,
        logs,
        200,
      )
    ) {
      continue;
    }
    const mine: NotificationLog[] = (logs.json?.items ?? []).filter(
      (log: { coffee_chat_request_pk: string }) =>
        log.coffee_chat_request_pk === requestId,
    );
    assert(
      `알림 발송 기록 목록(${channel})에 이번 요청의 두 이벤트가 있음`,
      EVENTS.every((event) => mine.some((log) => log.event === event)),
      JSON.stringify(mine.map((log) => [log.event, log.status])),
    );
  }

  if (PHONE) {
    console.log(
      `\n  휴대폰(${PHONE.slice(0, 3)}****${PHONE.slice(-4)})에서 알림톡 2건(커피챗 요청 도착 · 연락처 공유 안내)을 확인하세요`,
    );
    console.log(
      "  각 알림톡의 [Cheers에서 확인하기] 버튼이 로그인 후 이번 신청의 상세 화면(/applications/{id})을 여는지도 확인하세요",
    );
    const answer = await ask(
      "  두 알림톡을 받았고 버튼이 신청 상세를 열었나요? (y/N): ",
    );
    assert(
      "알림톡 2건 수신 · 버튼 링크 확인 (직접 확인)",
      answer.trim().toLowerCase() === "y",
    );
  }

  // 상세의 graduated.pk가 명함 API의 graduatedPk
  const graduatedPk: string | undefined = detail.json?.graduated?.pk;
  check(
    "GET /manager/business-card (명함 목록)",
    await req("GET", `${MANAGER}/business-card?page=1&size=5`, manager),
    200,
  );
  if (!graduatedPk) {
    failed("요청 상세에 현업자 pk가 있음", detail.text);
    return;
  }
  const card = await req(
    "GET",
    `${MANAGER}/business-card/${graduatedPk}`,
    manager,
  );
  if (check("GET /manager/business-card/{id} (열람 기록 저장)", card, 200)) {
    check(
      "명함 이미지 내려받기 (presigned GET)",
      await send(card.json.url, { method: "GET" }),
      200,
    );
  }
}

async function finishAccount(account: Account): Promise<void> {
  const { refresh, label } = account;
  const refreshed = await req("POST", "/api/v1/user/refresh", null, {
    refresh_token: refresh,
  });
  // refresh token은 재발급되지 않으므로 access token만 바뀜
  if (check(`POST /user/refresh (${label})`, refreshed, OK)) {
    account.access = refreshed.json.access_token;
  }
  check(
    `POST /user/logout (${label})`,
    await req("POST", "/api/v1/user/logout", account, {
      refresh_token: refresh,
    }),
    OK,
  );
  check(
    `로그아웃한 refresh token 재사용 거부 (${label})`,
    await req("POST", "/api/v1/user/refresh", null, { refresh_token: refresh }),
    401,
  );
}

// 만든 계정 · 회사를 지움. 실패해도 나머지는 계속 정리
async function cleanup(state: State): Promise<void> {
  const { manager, hardDelete, accounts } = state;
  if (KEEP_DATA) {
    warn("KEEP_DATA=1이라 정리하지 않음 (계정 · 회사가 남아 있음)");
    return;
  }

  let usersGone = true;
  for (const account of accounts) {
    if (manager && hardDelete) {
      usersGone =
        check(
          `DELETE /manager/dev/user/{id} (${account.label} 완전탈퇴)`,
          await req("DELETE", `${MANAGER}/dev/user/${account.id}`, manager),
          200,
        ) && usersGone;
    } else {
      usersGone = false;
      check(
        `POST /user/withdraw (${account.label}, 유예기간 뒤 삭제. 그 안에 로그인하면 취소)`,
        await req("POST", "/api/v1/user/withdraw", account),
        OK,
      );
    }
  }

  if (state.companies.length === 0) return;
  // 현업자가 남아 있으면 고른 회사는 지울 수 없음 (409)
  if (!manager || !usersGone) {
    warn(
      `현업자가 남아 있어 회사를 지우지 않음 (company_id: ${state.companies.join(", ")})`,
    );
    return;
  }
  for (const id of state.companies) {
    check(
      `DELETE /manager/company/${id} (로고 포함)`,
      await req("DELETE", `${MANAGER}/company/${id}`, manager),
      200,
    );
  }
}

async function run(state: State): Promise<void> {
  step("0. 서버 상태 (ingress · 기동 · DB 연결)");
  must("GET /health", await req("GET", "/health"), 200);
  must("GET /health/ready", await req("GET", "/health/ready"), 200);

  step("1. 어드민: IdP 로그인 · 회사 등록");
  const manager = await managerLogin();
  state.manager = manager;
  state.hardDelete = await checkHardDelete(manager);
  // 같은 날 여러 번 돌려도 회사 표기가 겹치지 않게 붙임
  const suffix = String(randomInt(100000, 1000000));
  const company = await createCompany(manager, state, suffix);

  step("2. 재학생 계정: Google 로그인 · 가입");
  const student = await googleLogin("재학생", "student", state);
  const studentBody = await studentSignup(student);

  step("3. 현업자 계정: Google 로그인 · 가입 (재학생과 다른 Google 계정)");
  const graduated = await googleLogin("현업자", "graduated", state);
  const { nickname, body: graduatedBody } = await graduatedSignup(
    graduated,
    manager,
    state,
    company,
    suffix,
  );
  check(
    "현업자도 GET /cheers (현업자 목록) 가능",
    await req("GET", "/api/v1/cheers?page=1&size=1", graduated),
    200,
  );

  step("4. 알림 방식 설정: 두 계정의 알림톡 켜기 (마이페이지 수정)");
  if (PHONE) {
    await enableAlimtalk(student, "student", studentBody);
    await enableAlimtalk(graduated, "graduated", graduatedBody);
  } else {
    warn("PHONE이 없어 알림톡을 켜지 않음 (메일 알림만 확인)");
  }

  step("5. 재학생: 현업자 목록 · 커피챗 요청");
  const requestId = await requestCoffeeChat(student, nickname, company);

  step("6. 현업자: 받은 요청 확인 · 연락처 공유");
  const shared = await shareContact(graduated, requestId);

  step("7. 재학생: 연락처 공유 후 보낸 요청");
  await confirmShared(student, requestId, shared);

  step("8. 어드민: 커피챗 요청 · 알림 발송 결과 · 명함 확인");
  await checkManagerViews(manager, requestId, nickname);

  step("9. 토큰 갱신 · 로그아웃");
  await finishAccount(student);
  await finishAccount(graduated);
}

async function main(): Promise<void> {
  if (!GOOGLE_CLIENT_ID) {
    console.log("GOOGLE_CLIENT_ID를 지정하세요 (웹 client ID)");
    process.exit(2);
  }
  if (!MANAGER_TOKEN && !IDP_CLIENT_ID) {
    console.log(
      "IDP_CLIENT_ID(대상 서버와 같은 값) 또는 MANAGER_TOKEN을 지정하세요",
    );
    process.exit(2);
  }
  for (const uri of [
    REDIRECT_URI,
    ...(MANAGER_TOKEN ? [] : [MANAGER_REDIRECT_URI]),
  ]) {
    const redirect = new URL(uri);
    if (redirect.protocol !== "http:" || redirect.hostname !== "localhost") {
      console.log(
        `${uri}: redirect URI는 http://localhost:<포트> 형식이어야 합니다 (이 스크립트가 그 포트에서 로그인 결과를 받음)`,
      );
      process.exit(2);
    }
  }
  if (PHONE && !/^01\d{8,9}$/.test(PHONE)) {
    console.log("PHONE은 하이픈 없는 휴대폰 번호여야 합니다 (예: 01012345678)");
    process.exit(2);
  }

  console.log(`대상 서버: ${BASE_URL}`);
  const state: State = {
    manager: null,
    hardDelete: false,
    accounts: [],
    companies: [],
  };
  try {
    await run(state);
  } catch (error) {
    if (!(error instanceof Abort)) failed("예상하지 못한 오류", String(error));
  }

  if (state.accounts.length === 0 && state.companies.length === 0) summary();
  step(
    state.hardDelete
      ? "10. 정리: 완전탈퇴 · 회사 삭제"
      : "10. 정리: 탈퇴 요청 (완전탈퇴를 쓸 수 없음)",
  );
  await cleanup(state);

  summary();
}

void main();
