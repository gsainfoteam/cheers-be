import { like, notInArray } from "drizzle-orm";
import { adminAccessLog } from "@drizzle/schema/admin-access-log";
import { consent } from "@drizzle/schema/consent";
import { department } from "@drizzle/schema/department";
import { interest } from "@drizzle/schema/interest";
import { notificationLog } from "@drizzle/schema/notification-log";
import { InterestService } from "@src/student/interest.service";
import { createE2eApp, E2eContext } from "./support/app";
import {
  agreeConsents,
  bearer,
  getInfo,
  http,
  login,
  loginManager,
  Session,
  submitBusinessCard,
  verifyStudentEmail,
  graduatedInfoBody,
  waitUntil,
} from "./support/flows";

const MANAGER = "/api/manager/v1";
const SUPER = "super@gm.gist.ac.kr";
const NEW_ADMIN = "new-admin@gm.gist.ac.kr";
const GIST_PK = 1;
const CONSENT_TYPE = "e2e_flow";
const CONSENT_VERSION = "e2e-flow-1";

// 시나리오: 어드민 로그인 → 관리 작업 → 앱 API에 반영 → 어드민이 결과를 확인
describe("어드민 종합 시나리오", () => {
  let ctx: E2eContext;
  let seedDepartmentPks: number[];
  let seedInterests: (typeof interest.$inferSelect)[];

  const as = (auth: string) => ({
    get: (path: string) =>
      http(ctx).get(`${MANAGER}${path}`).set("Authorization", auth),
    post: (path: string, body: object = {}) =>
      http(ctx).post(`${MANAGER}${path}`).set("Authorization", auth).send(body),
    patch: (path: string, body: object) =>
      http(ctx)
        .patch(`${MANAGER}${path}`)
        .set("Authorization", auth)
        .send(body),
    delete: (path: string) =>
      http(ctx).delete(`${MANAGER}${path}`).set("Authorization", auth),
  });

  const app = (session: Session) => ({
    get: (path: string) =>
      http(ctx).get(path).set("Authorization", bearer(session)),
    post: (path: string, body: object = {}) =>
      http(ctx).post(path).set("Authorization", bearer(session)).send(body),
  });

  // 학과 · 관심사 · 약관은 reset으로 비워지지 않는 기준 데이터라 되돌림. 프로필이 참조하므로 reset 뒤에 함
  const restoreSeed = async () => {
    await ctx.reset();
    await ctx.db
      .delete(department)
      .where(notInArray(department.pk, seedDepartmentPks));
    await ctx.db.delete(interest);
    await ctx.db.insert(interest).values(seedInterests);
    await ctx.app.get(InterestService).refresh();
    await ctx.db.delete(consent).where(like(consent.version, "e2e-%"));
  };

  beforeAll(async () => {
    ctx = await createE2eApp();
    seedDepartmentPks = (
      await ctx.db.select({ pk: department.pk }).from(department)
    ).map((row) => row.pk);
    seedInterests = await ctx.db.select().from(interest);
    await restoreSeed();
  });
  afterAll(async () => {
    await restoreSeed();
    await ctx.close();
  });

  it("superadmin이 admin을 등록하고, admin의 관리 작업이 가입 · 커피챗에 반영되며, 결과를 어드민 화면에서 확인", async () => {
    // 메일 발송 결과를 notification_log에 남기도록 성공으로 둠
    ctx.mail.sendResult = { success: true, messageId: "e2e-mail" };

    // 1. superadmin이 admin 계정을 등록하고, admin이 IdP로 로그인
    const superAuth = await loginManager(ctx, SUPER, "superadmin");
    const account = await as(superAuth)
      .post("/admin-account", { email: NEW_ADMIN })
      .expect(201);
    expect(account.body).toMatchObject({ email: NEW_ADMIN, role: "admin" });

    const loginRes = await http(ctx)
      .post(`${MANAGER}/auth/login`)
      .send({
        code: `fake-idp-code:${NEW_ADMIN}`,
        redirect_uri: "http://localhost:5174/admin/callback",
        code_verifier: "e2e-verifier",
      })
      .expect(201);
    const adminAuth = `Bearer ${loginRes.body.access_token}`;
    expect(
      (await as(adminAuth).get("/auth/me").expect(200)).body,
    ).toMatchObject({ email: NEW_ADMIN, role: "admin" });

    // 2. admin: 학과 · 관심사 · 회사(다른 표기 포함) 등록. 약관 등록은 superadmin만
    const dept = await as(adminAuth)
      .post(`/school/${GIST_PK}/department`, { name: "시나리오학과" })
      .expect(201);
    const topic = await as(adminAuth)
      .post("/interest", { name: "시나리오관심사" })
      .expect(201);
    const company = await as(adminAuth)
      .post("/company", { name: "Cheers Corp", names: ["취얼스"] })
      .expect(201);
    const consentBody = {
      type: CONSENT_TYPE,
      version: CONSENT_VERSION,
      is_required: true,
      url: "https://terms.example.com/e2e-flow",
    };
    await as(adminAuth).post("/consent", consentBody).expect(403);
    await as(superAuth).post("/consent", consentBody).expect(201);

    // 3. 현업자 가입: 새 약관에 동의하고, 다른 표기로 입력한 회사가 등록된 회사로 연결
    const graduated = await login(ctx, "graduated");
    const graduatedConsents = await app(graduated)
      .get("/api/v1/user/consent/list")
      .expect(200);
    expect(graduatedConsents.body.consents).toContainEqual(
      expect.objectContaining({ type: CONSENT_TYPE, version: CONSENT_VERSION }),
    );
    await agreeConsents(ctx, graduated);
    await submitBusinessCard(ctx, graduated);
    const graduatedSignup = await app(graduated)
      .post(
        "/api/v1/user/graduated/info",
        graduatedInfoBody({ company_name: "취얼스", nickname: "시나리오현업" }),
      )
      .expect(201);
    const graduatedSession: Session = {
      ...graduated,
      accessToken: graduatedSignup.body.access_token,
    };
    expect(
      (await getInfo(ctx, graduatedSession)).graduated.profile,
    ).toMatchObject({
      company_id: company.body.company_id,
      company: "Cheers Corp",
    });

    // 4. 재학생 가입: 새 학과 · 관심사를 앱 목록에서 보고 고름
    const student = await login(ctx, "student");
    await agreeConsents(ctx, student);
    await verifyStudentEmail(ctx, student, "flow@gm.gist.ac.kr");
    const departments = await app(student)
      .get("/api/v1/user/student/departments")
      .expect(200);
    expect(departments.body.departments).toContainEqual({
      id: dept.body.pk,
      name: "시나리오학과",
    });
    const interests = await app(student)
      .get("/api/v1/user/student/interests")
      .expect(200);
    expect(interests.body.interests).toContain("시나리오관심사");
    const studentSignup = await app(student)
      .post("/api/v1/user/student/info", {
        name: "김재학",
        department_id: dept.body.pk,
        interests: [topic.body.name],
        contact: {
          email_enabled: true,
          kakao_enabled: false,
          email: "student-contact@example.com",
        },
      })
      .expect(201);
    const studentSession: Session = {
      ...student,
      accessToken: studentSignup.body.access_token,
    };
    expect(await getInfo(ctx, studentSession)).toMatchObject({
      status: "active",
      consent_required: false,
      student: {
        profile: {
          department: { id: dept.body.pk, name: "시나리오학과" },
          interests: ["시나리오관심사"],
        },
      },
    });

    // 5. 재학생이 목록에서 현업자를 보고 요청 → 현업자가 연락처 공유
    const cards = await app(studentSession).get("/api/v1/cheers").expect(200);
    const card = cards.body.items.find(
      (c: { nickname: string }) => c.nickname === "시나리오현업",
    );
    expect(card).toMatchObject({ company: "Cheers Corp" });
    const request = await app(studentSession)
      .post("/api/v1/cheers/request", {
        graduated_id: card.graduated_id,
        message: "시나리오 질문",
      })
      .expect(201);
    await app(graduatedSession)
      .post(`/api/v1/cheers/received/${request.body.id}/share-contact`)
      .expect(200);
    await waitUntil(
      async () => (await ctx.db.select().from(notificationLog)).length === 2,
    );

    // 6. admin이 결과를 확인: 약관 현황, 요청 목록 · 상세, 알림 발송 결과, 명함 열람 기록
    expect(
      (
        await as(adminAuth)
          .get(`/consent/${CONSENT_TYPE}/${CONSENT_VERSION}/status`)
          .expect(200)
      ).body,
    ).toMatchObject({ agreed_count: 2, revoked_count: 0 });

    const requests = await as(adminAuth)
      .get("/coffee-chat/request")
      .expect(200);
    expect(requests.body.items).toEqual([
      expect.objectContaining({
        pk: request.body.id,
        status: "contact_shared",
        student: expect.objectContaining({ name: "김재학" }),
        graduated: expect.objectContaining({
          nickname: "시나리오현업",
          company: "Cheers Corp",
        }),
      }),
    ]);
    const requestDetail = await as(adminAuth)
      .get(`/coffee-chat/request/${request.body.id}`)
      .expect(200);
    expect(requestDetail.body).toMatchObject({
      message: "시나리오 질문",
      status: "contact_shared",
    });
    expect(
      requestDetail.body.notifications
        .map((n: { event: string; status: string }) => `${n.event}:${n.status}`)
        .sort(),
    ).toEqual(["coffee_chat_requested:sent", "contact_shared:sent"]);

    const logs = await as(adminAuth)
      .get("/coffee-chat/notification-log")
      .query({ channel: "email" })
      .expect(200);
    expect(logs.body.total).toBe(2);

    const graduatedPk = requests.body.items[0].graduated.pk;
    await as(adminAuth).get(`/business-card/${graduatedPk}`).expect(200);
    expect(await ctx.db.select().from(adminAccessLog)).toEqual([
      expect.objectContaining({
        adminEmail: NEW_ADMIN,
        targetType: "business_card",
        targetId: graduatedPk,
      }),
    ]);

    // 7. superadmin이 권한을 올리면 같은 토큰으로 superadmin 작업이 되고, 다시 내린 뒤 계정을 지우면 토큰이 막힘
    await as(adminAuth)
      .post("/admin-account", { email: "third@gm.gist.ac.kr" })
      .expect(403);
    await as(superAuth)
      .patch(`/admin-account/${account.body.pk}`, { role: "superadmin" })
      .expect(200);
    await as(adminAuth)
      .post("/admin-account", { email: "third@gm.gist.ac.kr" })
      .expect(201);

    // superadmin은 지울 수 없어 admin으로 내린 뒤 지움
    await as(superAuth)
      .patch(`/admin-account/${account.body.pk}`, { role: "admin" })
      .expect(200);
    await as(superAuth).delete(`/admin-account/${account.body.pk}`).expect(200);
    await as(adminAuth).get("/auth/me").expect(401);
  });
});
