import { eq } from "drizzle-orm";
import { users } from "@drizzle/schema/users";
import { createE2eApp, E2eContext } from "./support/app";
import {
  bearer,
  getInfo,
  http,
  login,
  signupGraduated,
  signupStudent,
} from "./support/flows";

describe("시나리오 3: 가입 완료 회원 즉시 탈퇴", () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  beforeEach(() => ctx.reset());
  afterAll(() => ctx.close());

  it("탈퇴하면 토큰과 OAuth 연결이 지워지고, 다음 로그인은 새 가입이 됨", async () => {
    const graduatedSession = await signupGraduated(ctx);
    const studentSession = await signupStudent(ctx);
    const { id: userPk } = await getInfo(ctx, graduatedSession);

    const before = await http(ctx)
      .get("/api/v1/cheers")
      .set("Authorization", bearer(studentSession))
      .expect(200);
    const graduatedId = before.body.items[0].graduated_id;

    await http(ctx)
      .post("/api/v1/user/withdraw")
      .set("Authorization", bearer(graduatedSession))
      .expect(201);

    const [withdrawing] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.pk, userPk));
    expect(withdrawing.isDeleted).toBe(true);
    expect(withdrawing.name).toBeNull();
    expect(withdrawing.email).toBeNull();

    // 모든 기기 로그아웃
    await http(ctx)
      .post("/api/v1/user/refresh")
      .send({ refresh_token: graduatedSession.refreshToken })
      .expect(401);

    // 탈퇴 완료 유저는 다른 회원에게 보이지 않고 요청도 못 받음
    const hidden = await http(ctx)
      .get("/api/v1/cheers")
      .set("Authorization", bearer(studentSession))
      .expect(200);
    expect(hidden.body.total).toBe(0);
    await http(ctx)
      .post("/api/v1/cheers/request")
      .set("Authorization", bearer(studentSession))
      .send({ graduated_id: graduatedId, message: "질문" })
      .expect(404);

    // OAuth 연결을 지웠으므로 다시 로그인하면 새 가입이 시작됨
    const again = await login(ctx, "graduated", graduatedSession.sub);
    const info = await getInfo(ctx, again);
    expect(info).toMatchObject({ status: "pending" });
    expect(info.id).not.toBe(userPk);

    const [withdrawn] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.pk, userPk));
    expect(withdrawn.isDeleted).toBe(true);

    const after = await http(ctx)
      .get("/api/v1/cheers")
      .set("Authorization", bearer(studentSession))
      .expect(200);
    expect(after.body.total).toBe(0);
  });
});
