import { eq } from "drizzle-orm";
import { refreshToken } from "@drizzle/schema/refresh-token";
import { createE2eApp, E2eContext } from "./support/app";
import { bearer, getInfo, http, signupStudent } from "./support/flows";

describe("token refresh", () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  beforeEach(() => ctx.reset());
  afterAll(() => ctx.close());

  it("refresh token은 재발급 · 연장 없이 로그아웃 전까지 계속 쓸 수 있음", async () => {
    const session = await signupStudent(ctx);
    const { id: userPk } = await getInfo(ctx, session);
    const storedTokens = () =>
      ctx.db.select().from(refreshToken).where(eq(refreshToken.userPk, userPk));
    const before = await storedTokens();
    const refresh = () =>
      http(ctx)
        .post("/api/v1/user/refresh")
        .send({ refresh_token: session.refreshToken });

    const responses = await Promise.all([refresh(), refresh()]);

    for (const res of responses) {
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ access_token: expect.any(String) });
    }
    expect(await storedTokens()).toEqual(before);

    await http(ctx)
      .post("/api/v1/user/logout")
      .set("Authorization", bearer(session))
      .send({ refresh_token: session.refreshToken })
      .expect(201);
    await refresh().expect(401);
  });
});
