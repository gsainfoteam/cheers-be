import { randomUUID } from "node:crypto";
import { eq, notInArray } from "drizzle-orm";
import { adminAccount } from "@drizzle/schema/admin-account";
import { department } from "@drizzle/schema/department";
import { school } from "@drizzle/schema/school";
import { schoolEmailDomain } from "@drizzle/schema/school-email-domain";
import { createE2eApp, E2eContext } from "./support/app";
import {
  agreeConsents,
  bearer,
  getInfo,
  http,
  login,
  saveStudentInfo,
  sendCode,
  Session,
  signupStudent,
  verifyStudentEmail,
} from "./support/flows";

const SCHOOLS = "/api/manager/v1/school";
const GIST_PK = 1;
const GIST_DOMAIN = "gm.gist.ac.kr";
const DEPARTMENTS = `${SCHOOLS}/${GIST_PK}/department`;
const EMAIL_DOMAINS = `${SCHOOLS}/${GIST_PK}/email-domain`;
const STUDENT_DEPARTMENTS = "/api/v1/user/student/departments";
const STUDENT_INFO = "/api/v1/user/student/info";

const SUPER = "super@gm.gist.ac.kr";
const ADMIN = "admin@gm.gist.ac.kr";

type DepartmentItem = { id: number; name: string };

describe("school · department admin", () => {
  let ctx: E2eContext;
  let seedDepartments: (typeof department.$inferSelect)[];
  let superAuth: string;
  let adminAuth: string;

  const tokenOf = async (email: string, role: "admin" | "superadmin") => {
    await ctx.db.insert(adminAccount).values({ pk: randomUUID(), email, role });
    const res = await http(ctx)
      .post("/api/manager/v1/auth/login")
      .send({
        code: `fake-idp-code:${email}`,
        redirect_uri: "http://localhost:5174/admin/callback",
        code_verifier: "e2e-verifier",
      })
      .expect(201);
    return `Bearer ${res.body.access_token}`;
  };

  // 기준 데이터는 reset으로 되돌아가지 않아 테스트마다 복구. 프로필이 참조하므로 reset 뒤에 함
  const restoreSeed = async () => {
    await ctx.db.delete(department).where(
      notInArray(
        department.pk,
        seedDepartments.map((d) => d.pk),
      ),
    );
    for (const d of seedDepartments) {
      await ctx.db
        .update(department)
        .set({ name: d.name, isActive: d.isActive })
        .where(eq(department.pk, d.pk));
    }
    await ctx.db
      .delete(schoolEmailDomain)
      .where(notInArray(schoolEmailDomain.domain, [GIST_DOMAIN]));
    await ctx.db.delete(school).where(notInArray(school.pk, [GIST_PK]));
  };

  const addDepartment = async (name: string) => {
    const res = await http(ctx)
      .post(DEPARTMENTS)
      .set("Authorization", adminAuth)
      .send({ name })
      .expect(201);
    return res.body as { pk: number; name: string; is_active: boolean };
  };

  const setActive = (pk: number, is_active: boolean) =>
    http(ctx)
      .patch(`${DEPARTMENTS}/${pk}`)
      .set("Authorization", adminAuth)
      .send({ is_active })
      .expect(200);

  const studentDepartments = async (
    session: Session,
  ): Promise<DepartmentItem[]> => {
    const res = await http(ctx)
      .get(STUDENT_DEPARTMENTS)
      .set("Authorization", bearer(session))
      .expect(200);
    return res.body.departments;
  };

  const profileBody = (departmentId: number, interest = "백엔드") => ({
    department_id: departmentId,
    interests: [interest],
    contact: {
      email_enabled: true,
      kakao_enabled: false,
      email: "student-contact@example.com",
    },
  });

  beforeAll(async () => {
    ctx = await createE2eApp();
    seedDepartments = await ctx.db
      .select()
      .from(department)
      .where(eq(department.schoolPk, GIST_PK));
  });
  beforeEach(async () => {
    await ctx.reset();
    superAuth = await tokenOf(SUPER, "superadmin");
    adminAuth = await tokenOf(ADMIN, "admin");
  });
  afterEach(async () => {
    await ctx.reset();
    await restoreSeed();
  });
  afterAll(() => ctx.close());

  describe("권한", () => {
    it("토큰이 없거나 사용자 토큰이면 모든 API가 401", async () => {
      const session = await login(ctx, "student");
      for (const auth of [undefined, bearer(session)]) {
        const headers: Record<string, string> = auth
          ? { Authorization: auth }
          : {};
        await http(ctx).get(SCHOOLS).set(headers).expect(401);
        await http(ctx).get(DEPARTMENTS).set(headers).expect(401);
        await http(ctx).post(DEPARTMENTS).set(headers).send({}).expect(401);
        await http(ctx)
          .patch(`${DEPARTMENTS}/1`)
          .set(headers)
          .send({})
          .expect(401);
        await http(ctx).put(EMAIL_DOMAINS).set(headers).send({}).expect(401);
      }
    });

    it("admin은 학과를 관리하지만 허용 도메인 변경은 403", async () => {
      const list = await http(ctx)
        .get(SCHOOLS)
        .set("Authorization", adminAuth)
        .expect(200);
      expect(list.body).toEqual([
        { pk: GIST_PK, name: "GIST", email_domains: [GIST_DOMAIN] },
      ]);

      await addDepartment("어드민이 추가한 학과");

      const res = await http(ctx)
        .put(EMAIL_DOMAINS)
        .set("Authorization", adminAuth)
        .send({ email_domains: [GIST_DOMAIN, "new.ac.kr"] })
        .expect(403);
      expect(res.body.message).toBe("Superadmin privilege is required.");
    });
  });

  describe("학과 관리", () => {
    it("추가 · 이름 수정 · 비활성화 · 재활성화", async () => {
      const created = await addDepartment("  새 학과 ");
      expect(created).toEqual({
        pk: expect.any(Number),
        school_pk: GIST_PK,
        name: "새 학과",
        is_active: true,
      });
      // seed의 pk와 겹치지 않음
      expect(seedDepartments.map((d) => d.pk)).not.toContain(created.pk);

      const renamed = await http(ctx)
        .patch(`${DEPARTMENTS}/${created.pk}`)
        .set("Authorization", adminAuth)
        .send({ name: "바뀐 학과" })
        .expect(200);
      expect(renamed.body).toMatchObject({
        name: "바뀐 학과",
        is_active: true,
      });

      const deactivated = await setActive(created.pk, false);
      expect(deactivated.body).toMatchObject({
        name: "바뀐 학과",
        is_active: false,
      });

      const list = await http(ctx)
        .get(DEPARTMENTS)
        .set("Authorization", adminAuth)
        .expect(200);
      expect(list.body).toHaveLength(seedDepartments.length + 1);
      expect(list.body).toContainEqual({
        pk: created.pk,
        school_pk: GIST_PK,
        name: "바뀐 학과",
        is_active: false,
      });

      const reactivated = await setActive(created.pk, true);
      expect(reactivated.body.is_active).toBe(true);
    });

    it("잘못된 요청과 없는 대상", async () => {
      const [first, second] = seedDepartments;
      const patch = (path: string, body: object) =>
        http(ctx).patch(path).set("Authorization", adminAuth).send(body);

      await http(ctx)
        .post(DEPARTMENTS)
        .set("Authorization", adminAuth)
        .send({ name: "   " })
        .expect(400);
      await http(ctx)
        .post(DEPARTMENTS)
        .set("Authorization", adminAuth)
        .send({ name: first.name })
        .expect(409);
      await http(ctx)
        .post(`${SCHOOLS}/999/department`)
        .set("Authorization", adminAuth)
        .send({ name: "새 학과" })
        .expect(404);
      await http(ctx)
        .get(`${SCHOOLS}/999/department`)
        .set("Authorization", adminAuth)
        .expect(404);
      await http(ctx)
        .get(`${SCHOOLS}/99999999999/department`)
        .set("Authorization", adminAuth)
        .expect(400);

      await patch(`${DEPARTMENTS}/${first.pk}`, {}).expect(400);
      await patch(`${DEPARTMENTS}/${first.pk}`, { name: null }).expect(400);
      await patch(`${DEPARTMENTS}/${first.pk}`, { name: second.name }).expect(
        409,
      );
      await patch(`${DEPARTMENTS}/99999`, { name: "새 학과" }).expect(404);
      await patch(`${SCHOOLS}/999/department/${first.pk}`, {
        name: "새 학과",
      }).expect(404);
    });

    it("비활성 학과와 같은 이름도 409", async () => {
      const created = await addDepartment("옛 학과");
      await setActive(created.pk, false);

      await http(ctx)
        .post(DEPARTMENTS)
        .set("Authorization", adminAuth)
        .send({ name: "옛 학과" })
        .expect(409);
    });
  });

  describe("비활성 학과와 앱 API", () => {
    it("목록에서 숨기고 새로 고를 수 없음. 재활성화하면 다시 고를 수 있음", async () => {
      const closed = await addDepartment("폐지된 학과");
      await setActive(closed.pk, false);

      const session = await signupStudent(ctx);
      const list = await studentDepartments(session);
      expect(list.map((d) => d.id)).not.toContain(closed.pk);
      expect(list).toHaveLength(seedDepartments.length);

      const res = await http(ctx)
        .post(STUDENT_INFO)
        .set("Authorization", bearer(session))
        .send(profileBody(closed.pk))
        .expect(400);
      expect(res.body.message).toBe("Department is no longer available");

      await setActive(closed.pk, true);
      expect((await studentDepartments(session)).map((d) => d.id)).toContain(
        closed.pk,
      );
      await http(ctx)
        .post(STUDENT_INFO)
        .set("Authorization", bearer(session))
        .send(profileBody(closed.pk))
        .expect(201);
    });

    it("가입 중에도 비활성 학과로 가입을 끝낼 수 없음", async () => {
      const closed = await addDepartment("폐지된 학과");
      await setActive(closed.pk, false);

      const session = await login(ctx, "student");
      await agreeConsents(ctx, session);
      await verifyStudentEmail(ctx, session, "pending@gm.gist.ac.kr");

      await http(ctx)
        .post(STUDENT_INFO)
        .set("Authorization", bearer(session))
        .send({ name: "김재학", ...profileBody(closed.pk) })
        .expect(400);
    });

    it("이미 고른 학생은 조회와 다른 항목 수정이 그대로 되고, 다른 학과로 옮기면 돌아올 수 없음", async () => {
      const closed = await addDepartment("곧 폐지될 학과");
      const session = await login(ctx, "student");
      await agreeConsents(ctx, session);
      await verifyStudentEmail(ctx, session, "keeper@gm.gist.ac.kr");
      const active = await saveStudentInfo(ctx, session, {
        department_id: closed.pk,
      });

      await setActive(closed.pk, false);

      const before = await getInfo(ctx, active);
      expect(JSON.stringify(before)).toContain("곧 폐지될 학과");

      // 학과를 그대로 두고 다른 항목만 수정
      await http(ctx)
        .post(STUDENT_INFO)
        .set("Authorization", bearer(active))
        .send(profileBody(closed.pk, "새 관심 분야"))
        .expect(201);
      const after = await getInfo(ctx, active);
      expect(JSON.stringify(after)).toContain("곧 폐지될 학과");
      expect(JSON.stringify(after)).toContain("새 관심 분야");

      // 다른 학과로 옮긴 뒤에는 비활성 학과를 다시 고를 수 없음
      await http(ctx)
        .post(STUDENT_INFO)
        .set("Authorization", bearer(active))
        .send(profileBody(seedDepartments[0].pk))
        .expect(201);
      await http(ctx)
        .post(STUDENT_INFO)
        .set("Authorization", bearer(active))
        .send(profileBody(closed.pk))
        .expect(400);
    });
  });

  describe("허용 이메일 도메인", () => {
    const putDomains = (email_domains: unknown) =>
      http(ctx)
        .put(EMAIL_DOMAINS)
        .set("Authorization", superAuth)
        .send({ email_domains });

    it("도메인을 추가하면 그 도메인으로 인증하고 같은 학교의 학과를 받음", async () => {
      const res = await putDomains([GIST_DOMAIN, "Student.GIST.ac.kr"]).expect(
        200,
      );
      expect(res.body).toEqual({
        pk: GIST_PK,
        name: "GIST",
        email_domains: [GIST_DOMAIN, "student.gist.ac.kr"],
      });

      const session = await login(ctx, "student");
      await agreeConsents(ctx, session);
      await verifyStudentEmail(ctx, session, "new@student.gist.ac.kr");
      expect(await studentDepartments(session)).toHaveLength(
        seedDepartments.length,
      );
    });

    it("빈 목록과 잘못된 형식은 400", async () => {
      await putDomains([]).expect(400);
      await putDomains(["not a domain"]).expect(400);
      await putDomains(["@gist.ac.kr"]).expect(400);
      await putDomains([GIST_DOMAIN, GIST_DOMAIN.toUpperCase()]).expect(400);
      await http(ctx)
        .put(EMAIL_DOMAINS)
        .set("Authorization", superAuth)
        .send({})
        .expect(400);
    });

    it("없는 학교는 404, 다른 학교의 도메인은 409", async () => {
      await http(ctx)
        .put(`${SCHOOLS}/999/email-domain`)
        .set("Authorization", superAuth)
        .send({ email_domains: ["a.ac.kr"] })
        .expect(404);

      await ctx.db.insert(school).values({ pk: 2, name: "다른 학교" });
      await ctx.db
        .insert(schoolEmailDomain)
        .values({ schoolPk: 2, domain: "other.ac.kr" });
      const res = await putDomains([GIST_DOMAIN, "other.ac.kr"]).expect(409);
      expect(res.body.message).toBe(
        "Email domain is already used by another school.",
      );

      const list = await http(ctx)
        .get(SCHOOLS)
        .set("Authorization", superAuth)
        .expect(200);
      expect(list.body).toEqual([
        { pk: GIST_PK, name: "GIST", email_domains: [GIST_DOMAIN] },
        { pk: 2, name: "다른 학교", email_domains: ["other.ac.kr"] },
      ]);
    });

    it("인증을 마친 재학생이 있는 도메인은 뺄 수 없고, 없으면 뺄 수 있음", async () => {
      await putDomains([GIST_DOMAIN, "extra.ac.kr"]).expect(200);

      // 아직 아무도 인증하지 않은 도메인은 뺄 수 있음
      await putDomains([GIST_DOMAIN]).expect(200);

      await signupStudent(ctx);
      const res = await putDomains(["new.ac.kr"]).expect(409);
      expect(res.body.message).toBe(
        `Email domain is in use by verified students: ${GIST_DOMAIN}`,
      );

      // 뒷부분만 같은 도메인은 사용 중이 아님
      await putDomains([GIST_DOMAIN, "gist.ac.kr"]).expect(200);
      await putDomains([GIST_DOMAIN]).expect(200);
    });

    it("뺀 도메인은 새 인증이 막히고, 이미 받은 인증번호도 쓸 수 없음", async () => {
      await putDomains([GIST_DOMAIN, "extra.ac.kr"]).expect(200);
      const email = "late@extra.ac.kr";
      const session = await login(ctx, "student");
      await agreeConsents(ctx, session);
      await sendCode(ctx, session, email);

      await putDomains([GIST_DOMAIN]).expect(200);

      const verify = await http(ctx)
        .post("/api/v1/user/student/verify/code")
        .set("Authorization", bearer(session))
        .send({ code: ctx.mail.latestVerificationCode(email) })
        .expect(400);
      expect(verify.body.message).toBe("Email domain not allowed");

      const other = await login(ctx, "student");
      await agreeConsents(ctx, other);
      const send = await http(ctx)
        .post("/api/v1/user/student/verify/send-code")
        .set("Authorization", bearer(other))
        .send({ email: "other@extra.ac.kr" })
        .expect(400);
      expect(send.body.message).toBe("Email domain not allowed");
    });
  });
});
