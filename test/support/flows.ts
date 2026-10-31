import { randomUUID } from "node:crypto";
import * as request from "supertest";
import { E2eContext } from "./app";

export type Session = {
  sub: string;
  accessToken: string;
  refreshToken: string;
};

export const http = (ctx: E2eContext) => request(ctx.app.getHttpServer());

export const bearer = (session: Session) =>
  `Bearer ${session.accessToken}` as const;

export const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
export const PDF_BYTES = Buffer.from("%PDF-1.7 e2e", "latin1");

export async function login(
  ctx: E2eContext,
  type: "student" | "graduated",
  sub: string = randomUUID(),
): Promise<Session> {
  const res = await http(ctx)
    .post("/api/v1/user/oauth/login")
    .send({
      provider: "google",
      type,
      token: `fake-google:${sub}:${sub}@gmail.com`,
      nonce: "e2e-nonce",
    })
    .expect(201);
  return {
    sub,
    accessToken: res.body.access_token,
    refreshToken: res.body.refresh_token,
  };
}

export async function getInfo(ctx: E2eContext, session: Session) {
  const res = await http(ctx)
    .get("/api/v1/user/info")
    .set("Authorization", bearer(session))
    .expect(200);
  return res.body;
}

// 약관 목록을 그대로 받아 필수 약관에 동의
export async function agreeConsents(
  ctx: E2eContext,
  session: Session,
): Promise<void> {
  const list = await http(ctx)
    .get("/api/v1/user/consent/list")
    .set("Authorization", bearer(session))
    .expect(200);
  await http(ctx)
    .post("/api/v1/user/consent")
    .set("Authorization", bearer(session))
    .send({
      consents: list.body.consents.map(
        (c: { type: string; version: string }) => ({
          type: c.type,
          version: c.version,
          agreed: true,
        }),
      ),
    })
    .expect(201);
}

export async function verifyStudentEmail(
  ctx: E2eContext,
  session: Session,
  email: string,
): Promise<void> {
  await sendCode(ctx, session, email);
  await http(ctx)
    .post("/api/v1/user/student/verify/code")
    .set("Authorization", bearer(session))
    .send({ code: ctx.mail.latestVerificationCode(email) })
    .expect(201);
}

export async function sendCode(
  ctx: E2eContext,
  session: Session,
  email: string,
): Promise<void> {
  await http(ctx)
    .post("/api/v1/user/student/verify/send-code")
    .set("Authorization", bearer(session))
    .send({ email })
    .expect(201);
}

// 추가 정보 저장으로 가입이 끝나면 새 토큰을 받음 (active 클레임)
export async function saveStudentInfo(
  ctx: E2eContext,
  session: Session,
  overrides: Record<string, unknown> = {},
): Promise<Session> {
  const departments = await http(ctx)
    .get("/api/v1/user/student/departments")
    .set("Authorization", bearer(session))
    .expect(200);
  const interests = await http(ctx)
    .get("/api/v1/user/student/interests")
    .set("Authorization", bearer(session))
    .expect(200);

  const res = await http(ctx)
    .post("/api/v1/user/student/info")
    .set("Authorization", bearer(session))
    .send({
      name: "김재학",
      department_id: departments.body.departments[0].id,
      interests: [interests.body.interests[0]],
      contact: {
        email_enabled: true,
        kakao_enabled: false,
        email: "student-contact@example.com",
      },
      ...overrides,
    })
    .expect(201);
  return withSignupTokens(session, res.body);
}

export async function signupStudent(
  ctx: E2eContext,
  email: string = `s${randomUUID().slice(0, 8)}@gm.gist.ac.kr`,
): Promise<Session> {
  const session = await login(ctx, "student");
  await agreeConsents(ctx, session);
  await verifyStudentEmail(ctx, session, email);
  return saveStudentInfo(ctx, session);
}

// 업로드 URL 발급 → (presigned PUT 대신) 가짜 S3에 직접 넣기 → 제출
export async function submitBusinessCard(
  ctx: E2eContext,
  session: Session,
): Promise<void> {
  const upload = await http(ctx)
    .post("/api/v1/file/business-card/upload-url")
    .set("Authorization", bearer(session))
    .send({ content_type: "image/jpeg", size: JPEG_BYTES.length })
    .expect(201);
  ctx.s3.put(upload.body.key, JPEG_BYTES);
  await http(ctx)
    .post("/api/v1/user/graduated/verify/business-card")
    .set("Authorization", bearer(session))
    .send({ key: upload.body.key })
    .expect(201);
}

// 이력서 업로드 URL 발급 → (presigned PUT 대신) 가짜 S3에 직접 넣기. 반환한 임시 key를 추가 정보 저장에 씀
export async function uploadAttachment(
  ctx: E2eContext,
  session: Session,
): Promise<string> {
  const upload = await http(ctx)
    .post("/api/v1/file/attachment/upload-url")
    .set("Authorization", bearer(session))
    .send({ content_type: "application/pdf", size: PDF_BYTES.length })
    .expect(201);
  ctx.s3.put(upload.body.key, PDF_BYTES);
  return upload.body.key;
}

export const graduatedInfoBody = (overrides: Record<string, unknown> = {}) => ({
  name: "박현업",
  nickname: `현업${randomUUID().slice(0, 6)}`,
  company: "인포테크",
  department: "플랫폼개발팀",
  job: "백엔드 개발자",
  hashtags: ["백엔드"],
  links: ["https://www.linkedin.com/in/e2e"],
  contact: {
    email_enabled: true,
    kakao_enabled: false,
    email: "graduated-contact@example.com",
  },
  ...overrides,
});

export async function signupGraduated(
  ctx: E2eContext,
  overrides: Record<string, unknown> = {},
): Promise<Session> {
  const session = await login(ctx, "graduated");
  await agreeConsents(ctx, session);
  await submitBusinessCard(ctx, session);
  const res = await http(ctx)
    .post("/api/v1/user/graduated/info")
    .set("Authorization", bearer(session))
    .send(graduatedInfoBody(overrides))
    .expect(201);
  return withSignupTokens(session, res.body);
}

const withSignupTokens = (
  session: Session,
  body: { access_token?: string; refresh_token?: string },
): Session => ({
  sub: session.sub,
  accessToken: body.access_token ?? session.accessToken,
  refreshToken: body.refresh_token ?? session.refreshToken,
});
