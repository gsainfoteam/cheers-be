import { randomUUID } from "node:crypto";
import { createE2eApp, E2eContext } from "./support/app";
import {
  bearer,
  getInfo,
  http,
  Session,
  signupGraduated,
  signupStudent,
} from "./support/flows";

describe("시나리오 2: 현업자 가입 → 재학생 목록 조회 → 커피챗 요청", () => {
  let ctx: E2eContext;

  const list = async (session: Session) =>
    (
      await http(ctx)
        .get("/api/v1/cheers")
        .set("Authorization", bearer(session))
        .expect(200)
    ).body;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  beforeEach(() => ctx.reset());
  afterAll(() => ctx.close());

  it("가입한 현업자가 목록에 보이고 요청이 양쪽에 남음", async () => {
    const graduatedSession = await signupGraduated(ctx, {
      nickname: "현업자e2e",
    });
    expect(await getInfo(ctx, graduatedSession)).toMatchObject({
      type: "graduated",
      status: "active",
      next_step: null,
      graduated: { verified: true },
    });
    const studentSession = await signupStudent(ctx);

    const page = await list(studentSession);
    expect(page.total).toBe(1);
    const card = page.items[0];
    expect(card).toMatchObject({
      nickname: "현업자e2e",
      company: "인포테크",
      job: "백엔드 개발자",
      can_request: true,
    });
    // 이름 · 부서 · 연락처는 비공개
    const raw = JSON.stringify(card);
    expect(raw).not.toContain("박현업");
    expect(raw).not.toContain("플랫폼개발팀");
    expect(raw).not.toContain("graduated-contact@example.com");

    const created = await http(ctx)
      .post("/api/v1/cheers/request")
      .set("Authorization", bearer(studentSession))
      .send({ graduated_id: card.graduated_id, message: "  질문 있습니다  " })
      .expect(201);

    const sent = await http(ctx)
      .get(`/api/v1/cheers/sent/${created.body.id}`)
      .set("Authorization", bearer(studentSession))
      .expect(200);
    expect(sent.body).toMatchObject({
      id: created.body.id,
      graduated: { graduated_id: card.graduated_id },
      graduated_withdrawn: false,
      message: "질문 있습니다",
      shared_contact: null,
    });

    const received = await http(ctx)
      .get("/api/v1/cheers/received")
      .set("Authorization", bearer(graduatedSession))
      .expect(200);
    expect(received.body.total).toBe(1);
    expect(received.body.items[0].id).toBe(created.body.id);

    // 알림은 응답 뒤에 비동기로 나감
    await waitUntil(() =>
      ctx.mail.sent.some((m) => m.to === "graduated-contact@example.com"),
    );
  });

  it("현업자는 재학생 API를 호출할 수 없음", async () => {
    const graduatedSession = await signupGraduated(ctx);

    await http(ctx)
      .get("/api/v1/cheers")
      .set("Authorization", bearer(graduatedSession))
      .expect(403);
  });

  it("없는 현업자에게 요청하면 404", async () => {
    const studentSession = await signupStudent(ctx);

    await http(ctx)
      .post("/api/v1/cheers/request")
      .set("Authorization", bearer(studentSession))
      .send({ graduated_id: randomUUID(), message: "질문" })
      .expect(404);
  });

  it("연락을 희망하지 않는 현업자에게 요청하면 409", async () => {
    await signupGraduated(ctx, {
      contact: { email_enabled: false, kakao_enabled: false },
    });
    const studentSession = await signupStudent(ctx);

    const card = (await list(studentSession)).items[0];
    expect(card.can_request).toBe(false);

    await http(ctx)
      .post("/api/v1/cheers/request")
      .set("Authorization", bearer(studentSession))
      .send({ graduated_id: card.graduated_id, message: "질문" })
      .expect(409);
  });
});

async function waitUntil(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Condition not met in time");
}
