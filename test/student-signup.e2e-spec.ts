import { users } from "@drizzle/schema/users";
import { createE2eApp, E2eContext } from "./support/app";
import {
  agreeConsents,
  bearer,
  getInfo,
  http,
  login,
  saveStudentInfo,
  sendCode,
} from "./support/flows";

describe("시나리오 1: 재학생 가입", () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  beforeEach(() => ctx.reset());
  afterAll(() => ctx.close());

  it("로그인 → 약관 동의 → 메일 인증 → 추가 정보 → active", async () => {
    const email = "e2e-student@gm.gist.ac.kr";

    const session = await login(ctx, "student");
    expect(await getInfo(ctx, session)).toMatchObject({
      type: "student",
      status: "pending",
      next_step: "consent",
      // 가입 중에는 next_step으로 안내. consent_required는 active 유저의 재동의용
      consent_required: false,
    });

    // 단계를 건너뛰면 가드가 막음
    await http(ctx)
      .post("/api/v1/user/student/verify/send-code")
      .set("Authorization", bearer(session))
      .send({ email })
      .expect(403);
    await http(ctx)
      .get("/api/v1/cheers")
      .set("Authorization", bearer(session))
      .expect(403);

    await agreeConsents(ctx, session);
    expect((await getInfo(ctx, session)).next_step).toBe("verify");

    // 허용되지 않은 도메인, 틀린 코드
    await http(ctx)
      .post("/api/v1/user/student/verify/send-code")
      .set("Authorization", bearer(session))
      .send({ email: "someone@gmail.com" })
      .expect(400);
    await sendCode(ctx, session, email);
    const code = ctx.mail.latestVerificationCode(email);
    const wrongCode = code === "000000" ? "000001" : "000000";
    const wrong = await http(ctx)
      .post("/api/v1/user/student/verify/code")
      .set("Authorization", bearer(session))
      .send({ code: wrongCode })
      .expect(400);
    expect(wrong.body.remaining_attempts).toBe(4);
    expect((await getInfo(ctx, session)).next_step).toBe("verify");

    await http(ctx)
      .post("/api/v1/user/student/verify/code")
      .set("Authorization", bearer(session))
      .send({ code })
      .expect(201);
    expect((await getInfo(ctx, session)).next_step).toBe("profile");

    const active = await saveStudentInfo(ctx, session);
    expect(active.accessToken).not.toBe(session.accessToken);

    const info = await getInfo(ctx, active);
    expect(info).toMatchObject({
      status: "active",
      next_step: null,
      name: "김재학",
      consent_required: false,
    });
    expect(info.student).toMatchObject({ email, verified: true });
    expect(info.student.profile.contact).toMatchObject({
      email_enabled: true,
      email: "student-contact@example.com",
    });

    // 가입을 마치면 목록 API가 열림
    await http(ctx)
      .get("/api/v1/cheers")
      .set("Authorization", bearer(active))
      .expect(200);
  });

  it("같은 학교 이메일은 다른 계정에서 다시 인증할 수 없음", async () => {
    const email = "e2e-dup@gm.gist.ac.kr";
    const first = await login(ctx, "student");
    await agreeConsents(ctx, first);
    await sendCode(ctx, first, email);
    await http(ctx)
      .post("/api/v1/user/student/verify/code")
      .set("Authorization", bearer(first))
      .send({ code: ctx.mail.latestVerificationCode(email) })
      .expect(201);

    const second = await login(ctx, "student");
    await agreeConsents(ctx, second);
    const res = await http(ctx)
      .post("/api/v1/user/student/verify/send-code")
      .set("Authorization", bearer(second))
      .send({ email })
      .expect(409);
    expect(res.body.error_code).toBe("EMAIL_ALREADY_REGISTERED");
  });

  it("OAuth 검증에 실패하면 401이고 유저가 만들어지지 않음", async () => {
    await http(ctx)
      .post("/api/v1/user/oauth/login")
      .send({
        provider: "google",
        type: "student",
        token: "invalid",
        nonce: "n",
      })
      .expect(401);
    expect(await ctx.db.select().from(users)).toHaveLength(0);
    await http(ctx).get("/api/v1/user/info").expect(401);
  });
});
