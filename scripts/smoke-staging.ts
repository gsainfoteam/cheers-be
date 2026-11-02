// 배포된 서버(기본 staging)에 대한 스모크 테스트. 코드 버그가 아니라 "배포 · 설정이 맞는지"를 본다
// (env 누락, DB 권한, 마이그레이션, 메일, S3 연결 등). CI의 e2e와는 별개
//
// Google 계정 2개로 재학생 · 현업자를 각각 로그인시켜 가입부터 커피챗 요청까지 진행한다
//   1) 재학생 가입 (약관 → 학교 메일 인증 → 추가 정보 → 파일 첨부)
//   2) 현업자 가입 (약관 → 명함 업로드 · 인증 → 추가 정보)
//   3) 재학생: 현업자 목록(비공개 정보 미노출 확인) → 커피챗 요청 → 보낸 요청(공유 전: 현업자 연락처 없음)
//   4) 현업자: 받은 요청 확인 → 연락처 공유
//   5) 재학생: 보낸 요청(공유 후: 상태 contact_shared + 현업자 연락처 보임)
//   6) 토큰 갱신 · 로그아웃 (WITHDRAW=1이면 이어서 두 계정 탈퇴 요청)
//
// 어드민 API(/api/manager/v1/...)는 IdP 로그인이 필요해 다루지 않는다
//
// macOS · Linux · Windows 공통 (bun만 있으면 됨)
//   bun run smoke:staging
// Google 로그인은 계정마다 한 번 브라우저에서 한다. REDIRECT_URI의 포트에 잠깐 서버를 띄워 ID token을 받으므로
// 그 포트가 비어 있어야 한다 (admin 개발 서버가 5173을 쓰고 있으면 끄거나 REDIRECT_URI를 바꿀 것)
//
// 환경변수 (셸 환경변수가 .env보다 우선. ENV_FILE로 다른 파일 지정 가능)
//   BASE_URL           대상 서버 (기본 https://api.stg.cheers.gistory.me)
//   GOOGLE_CLIENT_ID   웹 client ID. 서버 GOOGLE_CLIENT_ID와 같아야 함 (필수)
//   REDIRECT_URI       Google 콘솔에 등록한 localhost redirect URI (기본 http://localhost:5173)
//   SCHOOL_EMAIL       재학생 메일 인증에 쓸 학교 메일. 비우면 필요할 때 물어봄
//   WITHDRAW=1         마지막에 두 계정 모두 탈퇴 요청 (유예기간 뒤 삭제됨. 재로그인하면 취소)
//
// 이미 진행한 단계는 건너뜀: 서버가 알려 주는 next_step을 보고 이어서 진행하므로 여러 번 돌려도 됨
//   (같은 두 계정으로 다시 돌리면 커피챗 요청이 하나 더 만들어지고 현업자에게 알림 메일이 나감)
// 로그에는 토큰 · 비밀 값을 출력하지 않는다
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { createServer } from "node:http";
import { createInterface } from "node:readline/promises";
import * as dotenv from "dotenv";

dotenv.config({ quiet: true, path: process.env.ENV_FILE });

type UserKind = "student" | "graduated";
type Account = { access: string; refresh: string };
// 응답 본문을 스모크 테스트 안에서만 읽으므로 형식을 따로 정의하지 않음
type Res = { code: number; text: string; json: any };

// GOOGLE_CLIENT_ID는 서버 설정처럼 쉼표로 여러 개일 수 있으므로 첫 번째(웹 client)를 씀
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID ?? "").split(",")[0];
const BASE_URL = (
  process.env.BASE_URL || "https://api.stg.cheers.gistory.me"
).replace(/\/$/, "");
const REDIRECT_URI = process.env.REDIRECT_URI || "http://localhost:5173";
const WITHDRAW = process.env.WITHDRAW === "1";
const TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const OK = [200, 201];

// 서버가 업로드 파일의 시그니처(magic number)를 확인하므로 형식에 맞는 최소 파일을 씀
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const MINIMAL_PDF = Buffer.from("%PDF-1.4\n%%EOF\n");

let pass = 0;
let fail = 0;

const color = (code: number, text: string) => `\x1b[${code}m${text}\x1b[0m`;
const green = (text: string) => console.log(color(32, text));
const red = (text: string) => console.log(color(31, text));
const step = (text: string) => console.log(`\n${color(1, `== ${text}`)}`);

function summary(): never {
  console.log("\n────────────────────────────");
  const line = `통과 ${pass} / 실패 ${fail}`;
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

// 실패하면 이후 단계가 의미 없으므로 요약만 내고 종료
function must(name: string, res: Res, expect: number | number[]): void {
  if (!check(name, res, expect)) summary();
}
function mustAssert(name: string, condition: boolean, detail?: string): void {
  if (!assert(name, condition, detail)) summary();
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
  account?: Account | null,
  body?: unknown,
): Promise<Res> {
  const headers: Record<string, string> = {};
  if (account) headers.Authorization = `Bearer ${account.access}`;
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

// Google은 ID token을 주소의 # 뒤에 담아 보내고 #는 서버로 오지 않으므로, 페이지 스크립트가 다시 보내 줌
const CALLBACK_PAGE = `<!doctype html><meta charset="utf-8"><body>처리 중…<script>
fetch("/__smoke_callback",{method:"POST",body:location.hash.slice(1)})
  .then(()=>{document.body.textContent="완료. 이 탭을 닫고 터미널로 돌아가세요."})
  .catch(()=>{document.body.textContent="실패. 터미널을 확인하세요."});
</script>`;

// REDIRECT_URI의 포트에 서버를 띄워 로그인 결과를 받고 ID token을 돌려줌
function receiveIdToken(state: string, authUrl: string): Promise<string> {
  const { port, hostname } = new URL(REDIRECT_URI);
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      if (request.method !== "POST") {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(CALLBACK_PAGE);
        return;
      }
      let raw = "";
      request.on("data", (chunk) => (raw += chunk));
      request.on("end", () => {
        const params = new URLSearchParams(raw);
        // state가 다르면 이 로그인의 응답이 아니므로 무시하고 계속 기다림
        if (params.get("state") !== state) {
          response.statusCode = 400;
          response.end();
          return;
        }
        response.end();
        finish(() => {
          const token = params.get("id_token");
          if (token) resolve(token);
          else reject(new Error(`Google 로그인 실패: ${params.get("error")}`));
        });
      });
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
        reject(new Error(`${REDIRECT_URI}에서 대기할 수 없음: ${error}`)),
      ),
    );
    server.listen(Number(port) || 80, hostname, () => openBrowser(authUrl));
  });
}

// 로그인 후 내 정보까지 확인하고 토큰을 돌려줌
async function googleLogin(label: string, type: UserKind): Promise<Account> {
  const nonce = randomBytes(16).toString("hex");
  const state = randomBytes(16).toString("hex");
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams(
    {
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "id_token",
      scope: "openid email profile",
      nonce: createHash("sha256").update(nonce).digest("hex"),
      state,
      prompt: "select_account",
    },
  )}`;
  console.log(
    `[${label}] 브라우저에서 ${label} 계정으로 로그인하세요. 열리지 않으면 아래 주소를 직접 여세요.`,
  );
  console.log(authUrl);

  let token: string;
  try {
    token = await receiveIdToken(state, authUrl);
  } catch (error) {
    failed(`Google 로그인 (${label})`, String(error));
    summary();
  }

  const login = await req("POST", "/api/v1/user/oauth/login", null, {
    provider: "google",
    type,
    token,
    nonce,
  });
  must(`POST /user/oauth/login (${label})`, login, OK);
  mustAssert("응답에 토큰이 있음", Boolean(login.json?.access_token));
  const account: Account = {
    access: login.json.access_token,
    refresh: login.json.refresh_token,
  };

  const info = await req("GET", "/api/v1/user/info", account);
  must(`GET /user/info (${label})`, info, 200);
  console.log(
    `    status=${info.json.status} next_step=${info.json.next_step} type=${info.json.type}`,
  );
  // 가입을 마친 계정은 로그인 때 보낸 유형을 무시함 → 다른 유형으로 가입한 계정이면 흐름이 맞지 않음
  mustAssert(
    `${type} 계정임 (이미 다른 유형으로 가입한 계정이면 실패)`,
    info.json.type === type,
  );
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

// presigned PUT으로 파일을 올리고 key를 돌려줌. 실패하면 null
async function uploadFile(
  path: string,
  account: Account,
  contentType: string,
  file: Buffer,
): Promise<string | null> {
  const issued = await req("POST", path, account, {
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

// 가입이 이번 호출로 끝나면 새 토큰이 오므로 계정에 반영
function applySignupTokens(account: Account, res: Res): void {
  if (!res.json?.access_token) return;
  account.access = res.json.access_token;
  account.refresh = res.json.refresh_token;
}

async function studentSignup(account: Account): Promise<void> {
  await doConsent(account);

  let info = await req("GET", "/api/v1/user/info", account);
  let schoolEmail = process.env.SCHOOL_EMAIL ?? "";
  if (info.json.next_step === "verify") {
    console.log("\n  재학생 메일 인증 (실제 메일 발송 · SMTP 확인)");
    if (!schoolEmail) {
      schoolEmail = await ask("  학교 메일 주소 (예: id@gm.gist.ac.kr): ");
    }
    must(
      "POST /student/verify/send-code",
      await req("POST", "/api/v1/user/student/verify/send-code", account, {
        email: schoolEmail,
      }),
      OK,
    );
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
  console.log(`    관심 분야 ${interests.json.interests?.length}개`);

  info = await req("GET", "/api/v1/user/info", account);
  // 연락용 메일: 방금 인증한 학교 메일, 없으면 서버에 저장된 값 (재실행 시)
  const contactEmail: string =
    schoolEmail || info.json.student?.email || info.json.email;
  const profile = {
    name: info.json.name || "스모크재학생",
    department_id: departmentId,
    interests: ["스모크테스트"],
    activities: ["배포 확인"],
    contact: { email_enabled: true, kakao_enabled: false, email: contactEmail },
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
  if (!key) return;
  const savedFile = await req("POST", "/api/v1/user/student/info", account, {
    ...profile,
    attachments: [
      linkAttachment,
      { kind: "cv", source: "file", key, file_name: "smoke.pdf" },
    ],
  });
  if (!check("POST /student/info (파일 첨부 저장)", savedFile, OK)) return;
  info = await req("GET", "/api/v1/user/info", account);
  const attachment = info.json.student?.profile?.attachments?.find(
    (a: { source: string }) => a.source === "file",
  );
  if (!assert("내 정보에 파일 첨부가 있음", Boolean(attachment), info.text)) {
    return;
  }
  check(
    "첨부 파일 내려받기 (presigned GET)",
    await send(attachment.url, { method: "GET" }),
    200,
  );
}

// 가입 완료 후 현업자 닉네임을 돌려줌
async function graduatedSignup(account: Account): Promise<string> {
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
    if (!key) summary();
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
  if (info.json.next_step === "profile") {
    const contactEmail: string =
      info.json.email || (await ask("  현업자 연락 메일: "));
    const saved = await req("POST", "/api/v1/user/graduated/info", account, {
      name: info.json.name || "스모크현업자",
      nickname: `스모크${randomInt(1000, 10000)}`,
      company: "스모크컴퍼니",
      department: "플랫폼팀",
      job: "백엔드 개발자",
      hashtags: ["스모크", "배포확인"],
      links: ["https://example.com"],
      contact: {
        email_enabled: true,
        kakao_enabled: false,
        email: contactEmail,
      },
    });
    must("POST /graduated/info (가입 완료)", saved, OK);
    applySignupTokens(account, saved);
  } else {
    console.log(`  - 추가 정보 건너뜀 (next_step=${info.json.next_step})`);
  }

  info = await req("GET", "/api/v1/user/info", account);
  must("GET /user/info (가입 후)", info, 200);
  mustAssert("현업자 status=active", info.json.status === "active");
  const nickname: string = info.json.graduated?.profile?.nickname ?? "";
  mustAssert("닉네임이 있음", nickname !== "");
  console.log(`    현업자 닉네임: ${nickname}`);
  return nickname;
}

const hasNoKeys = (value: object, keys: string[]) =>
  keys.every((key) => !(key in value));
const hasRequest = (res: Res, id: string) =>
  (res.json?.items ?? []).some((item: { id: string }) => item.id === id);

async function requestCoffeeChat(
  student: Account,
  nickname: string,
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

async function finishAccount(label: string, account: Account): Promise<void> {
  const { refresh } = account;
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
  if (WITHDRAW) {
    check(
      `POST /user/withdraw (${label})`,
      await req("POST", "/api/v1/user/withdraw", account),
      OK,
    );
  }
}

async function main(): Promise<void> {
  if (!GOOGLE_CLIENT_ID) {
    console.log("GOOGLE_CLIENT_ID를 지정하세요 (웹 client ID)");
    process.exit(2);
  }
  const redirect = new URL(REDIRECT_URI);
  if (redirect.protocol !== "http:" || redirect.hostname !== "localhost") {
    console.log(
      "REDIRECT_URI는 http://localhost:<포트> 형식이어야 합니다 (이 스크립트가 그 포트에서 로그인 결과를 받음)",
    );
    process.exit(2);
  }

  console.log(`대상 서버: ${BASE_URL}`);
  step("0. 서버 상태 (ingress · 기동 · DB 연결)");
  must("GET /health", await req("GET", "/health"), 200);
  must("GET /health/ready", await req("GET", "/health/ready"), 200);

  step("1. 재학생 계정: Google 로그인 · 가입");
  const student = await googleLogin("재학생", "student");
  await studentSignup(student);

  step("2. 현업자 계정: Google 로그인 · 가입 (재학생과 다른 Google 계정)");
  const graduated = await googleLogin("현업자", "graduated");
  const nickname = await graduatedSignup(graduated);

  step("3. 재학생: 현업자 목록 · 커피챗 요청");
  const requestId = await requestCoffeeChat(student, nickname);

  step("4. 현업자: 받은 요청 확인 · 연락처 공유");
  const shared = await shareContact(graduated, requestId);

  step("5. 재학생: 연락처 공유 후 보낸 요청");
  await confirmShared(student, requestId, shared);

  step(
    WITHDRAW
      ? "6. 토큰 갱신 · 로그아웃 · 탈퇴 요청 (유예기간 뒤 삭제, 그 안에 로그인하면 취소)"
      : "6. 토큰 갱신 · 로그아웃",
  );
  await finishAccount("재학생", student);
  await finishAccount("현업자", graduated);

  summary();
}

void main();
