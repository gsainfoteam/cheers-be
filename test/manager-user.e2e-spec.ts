import { randomUUID } from "node:crypto";
import { adminAccessLog } from "@drizzle/schema/admin-access-log";
import { createE2eApp, E2eContext } from "./support/app";
import {
  bearer,
  getInfo,
  http,
  loginManager,
  signupGraduated,
  signupStudent,
} from "./support/flows";

const BASE = "/api/manager/v1/user";
const ADMIN = "admin@gm.gist.ac.kr";

describe("어드민 회원", () => {
  let ctx: E2eContext;
  let auth: string;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  beforeEach(async () => {
    await ctx.reset();
    auth = await loginManager(ctx, ADMIN, "admin");
  });
  afterAll(() => ctx.close());

  const get = (path: string) =>
    http(ctx).get(`${BASE}${path}`).set("Authorization", auth);

  const signupBoth = async () => {
    const student = await signupStudent(ctx, "alice@gm.gist.ac.kr", {
      name: "김재학",
    });
    const graduated = await signupGraduated(ctx, { name: "박현업" });
    return {
      studentPk: (await getInfo(ctx, student)).id,
      graduatedPk: (await getInfo(ctx, graduated)).id,
    };
  };

  describe("목록", () => {
    it("pk · 이름 · 소속을 내려주고 연락처 · OAuth 식별자는 내려주지 않음", async () => {
      const { studentPk, graduatedPk } = await signupBoth();

      const res = await get("").expect(200);

      expect(res.body).toMatchObject({ page: 1, size: 20, total: 2 });
      const student = res.body.items.find(
        (item: { pk: string }) => item.pk === studentPk,
      );
      const graduated = res.body.items.find(
        (item: { pk: string }) => item.pk === graduatedPk,
      );
      expect(student).toMatchObject({
        name: "김재학",
        type: "student",
        status: "active",
        withdrawal_state: "none",
      });
      expect(student.affiliation.school).toEqual(expect.any(String));
      expect(student.affiliation.department).toEqual(expect.any(String));
      expect(graduated).toMatchObject({
        name: "박현업",
        type: "graduated",
        affiliation: { company: "인포테크", job: "백엔드 개발자" },
      });
      const body = JSON.stringify(res.body);
      expect(body).not.toContain("student-contact@example.com");
      expect(body).not.toContain("graduated-contact@example.com");
      expect(body).not.toContain("provider_sub");
    });

    it("유형 필터와 pk 부분 일치 · 이름 · 이메일 검색", async () => {
      const { studentPk } = await signupBoth();

      const graduatedOnly = await get("?type=graduated").expect(200);
      expect(graduatedOnly.body.total).toBe(1);

      // pk의 가운데 일부를 대문자로 검색해도 찾음
      const byPk = await get(
        `?q=${studentPk.slice(9, 23).toUpperCase()}`,
      ).expect(200);
      expect(byPk.body.items.map((item: { pk: string }) => item.pk)).toEqual([
        studentPk,
      ]);

      const byName = await get(`?q=${encodeURIComponent("박현")}`).expect(200);
      expect(byName.body.total).toBe(1);

      // 이메일은 로그인 때 받은 값 (학교 이메일이 아님)
      const { email } = (await get(`/${studentPk}`).expect(200)).body;
      const byEmail = await get(
        `?q=${email.slice(2, 10).toUpperCase()}`,
      ).expect(200);
      expect(byEmail.body.items.map((item: { pk: string }) => item.pk)).toEqual(
        [studentPk],
      );

      // LIKE 와일드카드는 글자 그대로 찾음
      const wildcard = await get(`?q=${encodeURIComponent("%")}`).expect(200);
      expect(wildcard.body.total).toBe(0);
    });

    it("탈퇴 상태 필터", async () => {
      const { studentPk } = await signupBoth();
      await ctx.db.execute(
        `UPDATE users SET withdraw_requested_at = now() WHERE pk = '${studentPk}'`,
      );

      const requested = await get("?withdrawal=requested").expect(200);
      expect(
        requested.body.items.map((item: { pk: string }) => item.pk),
      ).toEqual([studentPk]);
      expect((await get("?withdrawal=none").expect(200)).body.total).toBe(1);
      expect((await get("?withdrawal=deleted").expect(200)).body.total).toBe(0);
      expect((await get("?withdrawal=all").expect(200)).body.total).toBe(2);
    });

    it("잘못된 query는 400", async () => {
      await get("?type=admin").expect(400);
      await get("?withdrawal=gone").expect(400);
      await get("?q=").expect(400);
      await get(
        "?created_from=2026-11-01T00:00:00Z&created_to=2026-10-01T00:00:00Z",
      ).expect(400);
    });
  });

  describe("상세", () => {
    it("재학생: 로그인 계정 · 프로필 · 연락수단 여부. 연락처 값은 없음", async () => {
      const { studentPk } = await signupBoth();

      const res = await get(`/${studentPk}`).expect(200);

      expect(res.body).toMatchObject({
        pk: studentPk,
        name: "김재학",
        type: "student",
        withdrawal_state: "none",
        contact_methods: { kakao_enabled: false, email_enabled: true },
        graduated: null,
        coffee_chat_request_count: 0,
      });
      expect(res.body.oauth_accounts).toHaveLength(1);
      expect(res.body.oauth_accounts[0].provider).toEqual(expect.any(String));
      expect(res.body.student).toMatchObject({
        school_email: "alice@gm.gist.ac.kr",
      });
      expect(res.body.consents.length).toBeGreaterThan(0);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain("student-contact@example.com");
      expect(body).not.toContain("provider_sub");
    });

    it("현업자: 프로필과 명함 등록 여부", async () => {
      const { graduatedPk } = await signupBoth();

      const res = await get(`/${graduatedPk}`).expect(200);

      expect(res.body.student).toBeNull();
      expect(res.body.graduated).toMatchObject({
        has_business_card: true,
        nickname: expect.any(String),
        company: "인포테크",
        department: "플랫폼개발팀",
        job: "백엔드 개발자",
      });
      expect(res.body.graduated.graduated_pk).toEqual(expect.any(String));
      expect(JSON.stringify(res.body)).not.toContain(
        "graduated-contact@example.com",
      );
    });

    it("없는 회원은 404, uuid가 아니면 400", async () => {
      await get(`/${randomUUID()}`).expect(404);
      await get("/not-a-uuid").expect(400);
    });
  });

  describe("연락처 보기", () => {
    it("연락처 값을 내려주고 열람 기록을 남김", async () => {
      const { studentPk } = await signupBoth();

      const res = await get(`/${studentPk}/contact`).expect(200);

      expect(res.body).toEqual({
        kakao_enabled: false,
        email_enabled: true,
        phone: null,
        email: "student-contact@example.com",
      });
      const logs = await ctx.db.select().from(adminAccessLog);
      expect(logs).toEqual([
        expect.objectContaining({
          adminEmail: ADMIN,
          targetType: "user_contact",
          targetId: studentPk,
        }),
      ]);
      // 기록에는 연락처 값이 없음
      expect(JSON.stringify(logs)).not.toContain("student-contact@example.com");
    });

    it("볼 때마다 기록이 쌓임", async () => {
      const { studentPk } = await signupBoth();

      await get(`/${studentPk}/contact`).expect(200);
      await get(`/${studentPk}/contact`).expect(200);

      expect(await ctx.db.select().from(adminAccessLog)).toHaveLength(2);
    });

    it("없는 회원은 404이고 기록을 남기지 않음", async () => {
      await get(`/${randomUUID()}/contact`).expect(404);
      await get("/not-a-uuid/contact").expect(400);

      expect(await ctx.db.select().from(adminAccessLog)).toEqual([]);
    });

    it("토큰이 없거나 앱 사용자 토큰이면 401", async () => {
      const student = await signupStudent(ctx);
      const { id } = await getInfo(ctx, student);

      await http(ctx).get(`${BASE}/${id}/contact`).expect(401);
      await http(ctx)
        .get(`${BASE}/${id}/contact`)
        .set("Authorization", bearer(student))
        .expect(401);
    });
  });
});
