import { randomUUID } from "node:crypto";
import { adminAccount } from "@drizzle/schema/admin-account";
import { createE2eApp, E2eContext } from "./support/app";
import { bearer, http, login, signupStudent } from "./support/flows";

const LOGIN = "/api/manager/v1/auth/login";
const ME = "/api/manager/v1/auth/me";
const ACCOUNTS = "/api/manager/v1/admin-account";

const SUPER = "super@gm.gist.ac.kr";
const ADMIN = "admin@gm.gist.ac.kr";

describe("manager auth", () => {
  let ctx: E2eContext;

  const seedAccount = async (
    email: string,
    role: "admin" | "superadmin" = "admin",
  ) => {
    const [row] = await ctx.db
      .insert(adminAccount)
      .values({ pk: randomUUID(), email, role })
      .returning();
    return row;
  };

  const managerLogin = (email: string) =>
    http(ctx)
      .post(LOGIN)
      .send({
        code: `fake-idp-code:${email}`,
        redirect_uri: "http://localhost:5174/admin/callback",
        code_verifier: "e2e-verifier",
      });

  const tokenOf = async (email: string): Promise<string> => {
    const res = await managerLogin(email).expect(201);
    return res.body.access_token;
  };

  const as = (token: string) => `Bearer ${token}`;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  beforeEach(() => ctx.reset());
  afterAll(() => ctx.close());

  describe("로그인", () => {
    it("허용된 이메일은 토큰을 받고 me를 읽음. IdP 이메일의 대소문자는 무시", async () => {
      await seedAccount(SUPER, "superadmin");

      const res = await managerLogin("Super@GM.gist.ac.kr").expect(201);
      expect(res.body).toEqual({ access_token: expect.any(String) });

      const me = await http(ctx)
        .get(ME)
        .set("Authorization", as(res.body.access_token))
        .expect(200);
      expect(me.body).toEqual({ email: SUPER, role: "superadmin" });
    });

    it("없는 이메일은 403", async () => {
      const res = await managerLogin("nobody@gm.gist.ac.kr").expect(403);
      expect(res.body.message).toBe(
        "This account is not allowed as a manager.",
      );
    });

    it("IdP가 이메일을 주지 않으면 403", async () => {
      await managerLogin("").expect(403);
    });

    it("IdP가 code를 거부하면 401", async () => {
      await http(ctx)
        .post(LOGIN)
        .send({
          code: "bad-code",
          redirect_uri: "http://localhost:5174/admin/callback",
          code_verifier: "e2e-verifier",
        })
        .expect(401);
    });

    it("필드가 빠지면 400", async () => {
      await http(ctx).post(LOGIN).send({ code: "x" }).expect(400);
    });
  });

  describe("토큰 분리", () => {
    it("사용자 토큰은 매니저 API에서, 매니저 토큰은 사용자 API에서 401", async () => {
      await seedAccount(SUPER, "superadmin");
      const managerToken = await tokenOf(SUPER);
      const session = await signupStudent(ctx);

      const userToManager = await http(ctx)
        .get(ME)
        .set("Authorization", bearer(session))
        .expect(401);
      expect(userToManager.body.message).toBe("Invalid token");

      const managerToUser = await http(ctx)
        .get("/api/v1/user/info")
        .set("Authorization", as(managerToken))
        .expect(401);
      expect(managerToUser.body.message).toBe("Invalid token");
    });

    it("가입 중(pending) 사용자 토큰도 매니저 API에서 401", async () => {
      const session = await login(ctx, "student");
      await http(ctx)
        .get(ACCOUNTS)
        .set("Authorization", bearer(session))
        .expect(401);
    });

    it("토큰이 없으면 401", async () => {
      const res = await http(ctx).get(ME).expect(401);
      expect(res.body.message).toBe("Missing access token");
    });
  });

  describe("계정 관리", () => {
    it("superadmin이 등록 · 권한 변경 · 삭제", async () => {
      await seedAccount(SUPER, "superadmin");
      const token = await tokenOf(SUPER);

      const created = await http(ctx)
        .post(ACCOUNTS)
        .set("Authorization", as(token))
        .send({ email: "New@gm.gist.ac.kr" })
        .expect(201);
      expect(created.body).toMatchObject({
        email: "new@gm.gist.ac.kr",
        role: "admin",
      });

      const updated = await http(ctx)
        .patch(`${ACCOUNTS}/${created.body.pk}`)
        .set("Authorization", as(token))
        .send({ role: "superadmin" })
        .expect(200);
      expect(updated.body.role).toBe("superadmin");

      await http(ctx)
        .patch(`${ACCOUNTS}/${created.body.pk}`)
        .set("Authorization", as(token))
        .send({ role: "admin" })
        .expect(200);

      const deleted = await http(ctx)
        .delete(`${ACCOUNTS}/${created.body.pk}`)
        .set("Authorization", as(token))
        .expect(200);
      expect(deleted.body).toEqual({ result: "OK" });

      const list = await http(ctx)
        .get(ACCOUNTS)
        .set("Authorization", as(token))
        .expect(200);
      expect(list.body.map((a: { email: string }) => a.email)).toEqual([SUPER]);
    });

    it("admin은 목록만 읽고 등록 · 변경 · 삭제는 403", async () => {
      await seedAccount(ADMIN);
      const target = await seedAccount("target@gm.gist.ac.kr");
      const token = await tokenOf(ADMIN);
      const auth = as(token);

      await http(ctx).get(ACCOUNTS).set("Authorization", auth).expect(200);
      await http(ctx)
        .post(ACCOUNTS)
        .set("Authorization", auth)
        .send({ email: "x@gm.gist.ac.kr" })
        .expect(403);
      await http(ctx)
        .patch(`${ACCOUNTS}/${target.pk}`)
        .set("Authorization", auth)
        .send({ role: "superadmin" })
        .expect(403);
      await http(ctx)
        .delete(`${ACCOUNTS}/${target.pk}`)
        .set("Authorization", auth)
        .expect(403);
    });

    it("잘못된 요청과 보호 규칙", async () => {
      const me = await seedAccount(SUPER, "superadmin");
      const other = await seedAccount("other@gm.gist.ac.kr", "superadmin");
      await seedAccount(ADMIN);
      const auth = as(await tokenOf(SUPER));
      const post = (body: object) =>
        http(ctx).post(ACCOUNTS).set("Authorization", auth).send(body);

      await post({ email: "not-an-email" }).expect(400);
      await post({ email: "a@gmail.com" }).expect(400);
      await post({ email: "b@gm.gist.ac.kr", role: "root" }).expect(400);
      await post({ email: ADMIN }).expect(409);

      await http(ctx)
        .patch(`${ACCOUNTS}/${me.pk}`)
        .set("Authorization", auth)
        .send({ role: "admin" })
        .expect(403);
      await http(ctx)
        .delete(`${ACCOUNTS}/${me.pk}`)
        .set("Authorization", auth)
        .expect(403);
      await http(ctx)
        .delete(`${ACCOUNTS}/${other.pk}`)
        .set("Authorization", auth)
        .expect(403);
      await http(ctx)
        .delete(`${ACCOUNTS}/not-a-uuid`)
        .set("Authorization", auth)
        .expect(400);
      await http(ctx)
        .delete(`${ACCOUNTS}/${randomUUID()}`)
        .set("Authorization", auth)
        .expect(404);
      await http(ctx)
        .patch(`${ACCOUNTS}/${randomUUID()}`)
        .set("Authorization", auth)
        .send({ role: "admin" })
        .expect(404);
    });

    it("권한 변경은 이미 발급된 토큰에도 다음 요청부터 반영", async () => {
      await seedAccount(SUPER, "superadmin");
      const target = await seedAccount(ADMIN);
      const superAuth = as(await tokenOf(SUPER));
      const adminAuth = as(await tokenOf(ADMIN));

      await http(ctx)
        .patch(`${ACCOUNTS}/${target.pk}`)
        .set("Authorization", superAuth)
        .send({ role: "superadmin" })
        .expect(200);

      const me = await http(ctx)
        .get(ME)
        .set("Authorization", adminAuth)
        .expect(200);
      expect(me.body.role).toBe("superadmin");
    });

    it("삭제된 계정의 토큰은 401. 같은 이메일로 다시 등록해도 이전 토큰은 무효", async () => {
      await seedAccount(SUPER, "superadmin");
      const target = await seedAccount(ADMIN);
      const superAuth = as(await tokenOf(SUPER));
      const oldAuth = as(await tokenOf(ADMIN));

      await http(ctx)
        .delete(`${ACCOUNTS}/${target.pk}`)
        .set("Authorization", superAuth)
        .expect(200);

      const res = await http(ctx)
        .get(ME)
        .set("Authorization", oldAuth)
        .expect(401);
      expect(res.body.message).toBe("Manager not found");

      await seedAccount(ADMIN);
      await http(ctx).get(ME).set("Authorization", oldAuth).expect(401);
    });
  });

  describe("정적 서빙", () => {
    it("/admin 밖의 경로에 영향이 없음", async () => {
      await http(ctx).get("/health").expect(200);
      await http(ctx).get("/").expect(404);
      await http(ctx).get("/callback").expect(404);
      await http(ctx).get("/api/unknown").expect(404);
    });
  });
});
