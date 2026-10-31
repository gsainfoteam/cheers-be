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

describe("시나리오 3: 탈퇴 → 유예기간 중 재로그인 시 취소", () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  beforeEach(() => ctx.reset());
  afterAll(() => ctx.close());

  it("탈퇴하면 토큰이 폐기되고 목록에서 사라지며, 재로그인하면 복구됨", async () => {
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
    expect(withdrawing.withdrawRequestedAt).not.toBeNull();
    expect(withdrawing.isDeleted).toBe(false);

    // 모든 기기 로그아웃
    await http(ctx)
      .post("/api/v1/user/refresh")
      .send({ refresh_token: graduatedSession.refreshToken })
      .expect(401);

    // 유예기간 중에는 다른 회원에게 보이지 않고 요청도 못 받음
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

    // 다시 로그인하면 같은 계정으로 돌아옴
    const again = await login(ctx, "graduated", graduatedSession.sub);
    const info = await getInfo(ctx, again);
    expect(info).toMatchObject({ id: userPk, status: "active" });

    const [restored] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.pk, userPk));
    expect(restored.withdrawRequestedAt).toBeNull();

    const after = await http(ctx)
      .get("/api/v1/cheers")
      .set("Authorization", bearer(studentSession))
      .expect(200);
    expect(after.body.items[0].graduated_id).toBe(graduatedId);
    await http(ctx)
      .post("/api/v1/cheers/request")
      .set("Authorization", bearer(studentSession))
      .send({ graduated_id: graduatedId, message: "질문" })
      .expect(201);
  });
});
