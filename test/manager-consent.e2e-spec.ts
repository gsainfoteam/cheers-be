import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { adminAccount } from "@drizzle/schema/admin-account";
import { consent } from "@drizzle/schema/consent";
import { users } from "@drizzle/schema/users";
import { createE2eApp, E2eContext } from "./support/app";
import {
  agreeConsents,
  bearer,
  getInfo,
  http,
  login,
  Session,
  signupStudent,
} from "./support/flows";

const BASE = "/api/manager/v1/consent";
const LOGIN = "/api/manager/v1/auth/login";
const USER_CONSENT = "/api/v1/user/consent";

const SUPER = "super@gm.gist.ac.kr";
const ADMIN = "admin@gm.gist.ac.kr";

// 테스트에서 넣은 약관은 이 접두사로 찾아 지움. consent는 reset의 TRUNCATE 대상이 아님
const TEST_VERSION_PREFIX = "e2e-";
const version = (name: string) => `${TEST_VERSION_PREFIX}${name}`;
const TEST_TYPE = "e2e_marketing";

const body = (overrides: Record<string, unknown> = {}) => ({
  type: TEST_TYPE,
  version: version("1"),
  is_required: false,
  url: "https://terms.example.com/e2e",
  ...overrides,
});

describe("manager consent", () => {
  let ctx: E2eContext;

  const tokenOf = async (
    email: string,
    role: "admin" | "superadmin",
  ): Promise<string> => {
    await ctx.db
      .insert(adminAccount)
      .values({ pk: randomUUID(), email, role })
      .onConflictDoNothing();
    const res = await http(ctx)
      .post(LOGIN)
      .send({
        code: `fake-idp-code:${email}`,
        redirect_uri: "http://localhost:5174/admin/callback",
        code_verifier: "e2e-verifier",
      })
      .expect(201);
    return `Bearer ${res.body.access_token}`;
  };

  const post = (auth: string, payload: object) =>
    http(ctx).post(BASE).set("Authorization", auth).send(payload);

  const statusOf = async (auth: string, type: string, ver: string) => {
    const res = await http(ctx)
      .get(`${BASE}/${type}/${ver}/status`)
      .set("Authorization", auth)
      .expect(200);
    return res.body;
  };

  const removeTestConsents = async () => {
    await ctx.reset();
    await ctx.db
      .delete(consent)
      .where(like(consent.version, `${TEST_VERSION_PREFIX}%`));
  };

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  beforeEach(removeTestConsents);
  afterEach(removeTestConsents);
  afterAll(() => ctx.close());

  describe("권한", () => {
    const path = () => `${BASE}/${TEST_TYPE}/${version("1")}/status`;

    it("토큰이 없으면 모든 API가 401", async () => {
      await http(ctx).get(BASE).expect(401);
      await http(ctx).post(BASE).send(body()).expect(401);
      await http(ctx).get(path()).expect(401);
    });

    it("사용자 JWT는 모든 API가 401", async () => {
      const auth = bearer(await signupStudent(ctx));

      await http(ctx).get(BASE).set("Authorization", auth).expect(401);
      await post(auth, body()).expect(401);
      await http(ctx).get(path()).set("Authorization", auth).expect(401);
    });

    it("일반 admin은 조회만 되고 등록은 403", async () => {
      const auth = await tokenOf(ADMIN, "admin");

      await http(ctx).get(BASE).set("Authorization", auth).expect(200);
      const res = await post(auth, body()).expect(403);
      expect(res.body.message).toBe("Superadmin privilege is required.");
      await http(ctx)
        .get(`${BASE}/tos/251022/status`)
        .set("Authorization", auth)
        .expect(200);

      const rows = await ctx.db
        .select()
        .from(consent)
        .where(eq(consent.type, TEST_TYPE));
      expect(rows).toEqual([]);
    });

    it("superadmin은 조회와 등록이 모두 됨", async () => {
      const auth = await tokenOf(SUPER, "superadmin");

      await http(ctx).get(BASE).set("Authorization", auth).expect(200);
      await post(auth, body()).expect(201);
      await http(ctx).get(path()).set("Authorization", auth).expect(200);
    });
  });

  describe("목록과 등록", () => {
    it("종류별로 최신 버전부터 나오고 최신 버전만 is_latest", async () => {
      const auth = await tokenOf(SUPER, "superadmin");

      const created = await post(auth, body()).expect(201);
      expect(created.body).toEqual({
        type: TEST_TYPE,
        version: version("1"),
        is_required: false,
        url: "https://terms.example.com/e2e",
        created_at: expect.any(String),
      });
      await post(auth, body({ version: version("2") })).expect(201);

      const res = await http(ctx)
        .get(BASE)
        .set("Authorization", auth)
        .expect(200);

      const types = res.body.map((t: { type: string }) => t.type);
      expect(types).toEqual(expect.arrayContaining(["privacy", "tos"]));

      const group = res.body.find(
        (t: { type: string }) => t.type === TEST_TYPE,
      );
      expect(
        group.versions.map((v: { version: string; is_latest: boolean }) => [
          v.version,
          v.is_latest,
        ]),
      ).toEqual([
        [version("2"), true],
        [version("1"), false],
      ]);
    });

    it("이미 있는 버전은 409이고 기존 행을 바꾸지 않음", async () => {
      const auth = await tokenOf(SUPER, "superadmin");
      await post(auth, body()).expect(201);

      const res = await post(
        auth,
        body({ is_required: true, url: "https://terms.example.com/other" }),
      ).expect(409);
      expect(res.body.message).toBe("This consent version already exists.");

      const [row] = await ctx.db
        .select()
        .from(consent)
        .where(
          and(eq(consent.type, TEST_TYPE), eq(consent.version, version("1"))),
        );
      expect(row.isRequired).toBe(false);
      expect(row.url).toBe("https://terms.example.com/e2e");
    });

    it.each([
      ["type 형식", { type: "Has Space" }],
      ["type 길이", { type: "a".repeat(65) }],
      ["version 형식", { version: "e2e/1" }],
      ["version 점으로 시작", { version: ".." }],
      ["version 길이", { version: "1".repeat(33) }],
      ["is_required 누락", { is_required: undefined }],
      ["is_required 문자열", { is_required: "true" }],
      ["url 프로토콜", { url: "javascript:alert(1)" }],
      ["url 프로토콜 없음", { url: "terms.example.com" }],
      ["url 길이", { url: `https://example.com/${"a".repeat(512)}` }],
    ])("%s 오류는 400", async (_name, overrides) => {
      const auth = await tokenOf(SUPER, "superadmin");
      await post(auth, body(overrides)).expect(400);
    });

    it("기존 버전을 수정 · 삭제하는 API는 없음", async () => {
      const auth = await tokenOf(SUPER, "superadmin");
      const path = `${BASE}/tos/251022`;

      await http(ctx)
        .patch(path)
        .set("Authorization", auth)
        .send({ is_required: false })
        .expect(404);
      await http(ctx).delete(path).set("Authorization", auth).expect(404);
    });
  });

  describe("재동의 요구", () => {
    const latestOf = async (session: Session, type: string) => {
      const res = await http(ctx)
        .get(`${USER_CONSENT}/list`)
        .set("Authorization", bearer(session))
        .expect(200);
      return res.body.consents.find((c: { type: string }) => c.type === type);
    };

    it("필수 약관을 등록하면 consent_required가 켜지고 재동의하면 꺼짐", async () => {
      const auth = await tokenOf(SUPER, "superadmin");
      const session = await signupStudent(ctx);
      expect((await getInfo(ctx, session)).consent_required).toBe(false);

      await post(
        auth,
        body({ version: version("required"), is_required: true }),
      ).expect(201);

      expect((await getInfo(ctx, session)).consent_required).toBe(true);
      expect(await latestOf(session, TEST_TYPE)).toMatchObject({
        version: version("required"),
        agreed: false,
      });

      await agreeConsents(ctx, session);
      expect((await getInfo(ctx, session)).consent_required).toBe(false);
    });

    it("선택 약관을 등록해도 consent_required는 꺼져 있음", async () => {
      const auth = await tokenOf(SUPER, "superadmin");
      const session = await signupStudent(ctx);

      await post(auth, body()).expect(201);

      expect((await getInfo(ctx, session)).consent_required).toBe(false);
    });
  });

  describe("현황", () => {
    const setup = async () => {
      const auth = await tokenOf(SUPER, "superadmin");
      await post(auth, body()).expect(201);
      return auth;
    };

    // 필수 약관은 요청마다 agreed: true로 함께 보내야 함 (ConsentService.updateConsents)
    const agree = async (session: Session, agreed: boolean) => {
      const list = await http(ctx)
        .get(`${USER_CONSENT}/list`)
        .set("Authorization", bearer(session))
        .expect(200);
      await http(ctx)
        .post(USER_CONSENT)
        .set("Authorization", bearer(session))
        .send({
          consents: list.body.consents.map(
            (c: { type: string; version: string }) => ({
              type: c.type,
              version: c.version,
              agreed: c.type === TEST_TYPE ? agreed : true,
            }),
          ),
        })
        .expect(201);
    };

    it("동의 · 철회 · 탈퇴를 사용자 단위로 겹치지 않게 셈", async () => {
      const auth = await setup();
      expect(await statusOf(auth, TEST_TYPE, version("1"))).toEqual({
        type: TEST_TYPE,
        version: version("1"),
        agreed_count: 0,
        revoked_count: 0,
        withdrawn_count: 0,
      });

      // 동의 유지
      const agreed = await signupStudent(ctx);
      await agree(agreed, true);
      // 철회
      const revoked = await signupStudent(ctx);
      await agree(revoked, true);
      await agree(revoked, false);
      // 철회 후 재동의: 행은 2개지만 사용자는 1명
      const again = await signupStudent(ctx);
      await agree(again, true);
      await agree(again, false);
      await agree(again, true);
      // 탈퇴 처리된 사용자: 동의 이력만 남음
      const withdrawn = await signupStudent(ctx);
      await agree(withdrawn, true);
      const { id: withdrawnPk } = await getInfo(ctx, withdrawn);
      await ctx.db
        .update(users)
        .set({ isDeleted: true })
        .where(eq(users.pk, withdrawnPk));

      expect(await statusOf(auth, TEST_TYPE, version("1"))).toEqual({
        type: TEST_TYPE,
        version: version("1"),
        agreed_count: 2,
        revoked_count: 1,
        withdrawn_count: 1,
      });
    });

    it("없는 버전은 404, 형식이 틀리면 400", async () => {
      const auth = await setup();

      const res = await http(ctx)
        .get(`${BASE}/${TEST_TYPE}/${version("none")}/status`)
        .set("Authorization", auth)
        .expect(404);
      expect(res.body.message).toBe("Consent version not found.");

      await http(ctx)
        .get(`${BASE}/${TEST_TYPE}/bad%00version/status`)
        .set("Authorization", auth)
        .expect(400);
    });
  });

  it("가입 중인 사용자도 login 후 목록에서 새 버전을 봄", async () => {
    const auth = await tokenOf(SUPER, "superadmin");
    await post(auth, body({ is_required: true })).expect(201);

    const pending = await login(ctx, "student");
    const res = await http(ctx)
      .get(`${USER_CONSENT}/list`)
      .set("Authorization", bearer(pending))
      .expect(200);
    expect(
      res.body.consents.find((c: { type: string }) => c.type === TEST_TYPE),
    ).toMatchObject({ version: version("1"), is_required: true });
  });
});
