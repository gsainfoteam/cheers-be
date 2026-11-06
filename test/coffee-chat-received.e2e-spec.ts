import { eq } from "drizzle-orm";
import { coffeeChatContact } from "@drizzle/schema/coffee-chat-contact";
import { coffeeChatRequest } from "@drizzle/schema/coffee-chat-request";
import { graduated as graduatedTable } from "@drizzle/schema/graduated";
import { createE2eApp, E2eContext } from "./support/app";
import {
  bearer,
  getInfo,
  http,
  Session,
  signupGraduated,
  signupStudent,
  waitUntil,
} from "./support/flows";

const RECEIVED = "/api/v1/cheers/received";
const SENT = "/api/v1/cheers/sent";
// graduatedInfoBody · saveStudentInfo의 기본값
const GRADUATED_NAME = "박현업";
const GRADUATED_EMAIL = "graduated-contact@example.com";
const STUDENT_NAME = "김재학";
const STUDENT_EMAIL = "student-contact@example.com";
const STUDENT_PHONE = "01098765432";

describe("현업자 받은 요청 → 열람 → 연락처 공유", () => {
  let ctx: E2eContext;

  // 재학생이 현업자에게 요청을 보내고, 요청 알림 메일이 나갈 때까지 기다림 (이후 알림과 섞이지 않게)
  const sendRequest = async (
    student: Session,
    graduated: Session,
    message = "질문 있습니다",
  ): Promise<string> => {
    const { id: userPk } = await getInfo(ctx, graduated);
    const [{ pk: graduatedId }] = await ctx.db
      .select({ pk: graduatedTable.pk })
      .from(graduatedTable)
      .where(eq(graduatedTable.userPk, userPk));
    const before = ctx.mail.sent.length;
    const res = await http(ctx)
      .post("/api/v1/cheers/request")
      .set("Authorization", bearer(student))
      .send({ graduated_id: graduatedId, message })
      .expect(201);
    await waitUntil(() => ctx.mail.sent.length > before);
    return res.body.id;
  };

  const receivedList = async (graduated: Session, query: object = {}) =>
    (
      await http(ctx)
        .get(RECEIVED)
        .query(query)
        .set("Authorization", bearer(graduated))
        .expect(200)
    ).body;

  const detail = (graduated: Session, id: string) =>
    http(ctx).get(`${RECEIVED}/${id}`).set("Authorization", bearer(graduated));

  const share = (graduated: Session, id: string) =>
    http(ctx)
      .post(`${RECEIVED}/${id}/share-contact`)
      .set("Authorization", bearer(graduated));

  const sentDetail = async (student: Session, id: string) =>
    (
      await http(ctx)
        .get(`${SENT}/${id}`)
        .set("Authorization", bearer(student))
        .expect(200)
    ).body;

  const requestRow = async (id: string) => {
    const [row] = await ctx.db
      .select()
      .from(coffeeChatRequest)
      .where(eq(coffeeChatRequest.pk, id));
    return row;
  };

  const withdraw = (session: Session) =>
    http(ctx)
      .post("/api/v1/user/withdraw")
      .set("Authorization", bearer(session))
      .expect(201);

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  beforeEach(() => ctx.reset());
  afterAll(() => ctx.close());

  it("상세를 처음 열면 viewed가 되고 다시 열어도 처음 열람 시각이 그대로", async () => {
    const graduated = await signupGraduated(ctx);
    const student = await signupStudent(ctx);
    const id = await sendRequest(student, graduated);

    const before = await receivedList(graduated);
    expect(before).toMatchObject({ total: 1, page: 1 });
    expect(before.items[0]).toMatchObject({
      id,
      student_name: STUDENT_NAME,
      student_withdrawn: false,
      status: "requested",
    });
    expect((await sentDetail(student, id)).status).toBe("requested");

    const first = await detail(graduated, id).expect(200);
    expect(first.body).toMatchObject({
      id,
      message: "질문 있습니다",
      status: "viewed",
      contact_shared_at: null,
      student: {
        name: STUDENT_NAME,
        interests: [expect.any(String)],
        activities: [],
        attachments: [],
        // 재학생은 메일만 골랐으므로 phone은 null
        email: STUDENT_EMAIL,
        phone: null,
      },
    });
    const viewedAt = (await requestRow(id)).graduatedViewedAt;
    expect(viewedAt).not.toBeNull();

    await detail(graduated, id).expect(200);
    expect((await requestRow(id)).graduatedViewedAt).toEqual(viewedAt);
    expect((await receivedList(graduated)).items[0].status).toBe("viewed");
    expect((await sentDetail(student, id)).status).toBe("viewed");
  });

  it("연락처를 공유하면 재학생의 보낸 요청에 보이고, 재학생에게 메일 · 알림톡이 나감", async () => {
    const graduated = await signupGraduated(ctx, {
      contact: {
        email_enabled: true,
        kakao_enabled: true,
        email: GRADUATED_EMAIL,
        phone: "010-1111-2222",
      },
    });
    const student = await signupStudent(ctx, undefined, {
      contact: {
        email_enabled: true,
        kakao_enabled: true,
        email: STUDENT_EMAIL,
        phone: "010-9876-5432",
      },
    });
    const id = await sendRequest(student, graduated);
    // 요청 알림톡은 현업자에게
    await waitUntil(() => ctx.alimtalk.sent.length === 1);
    ctx.mail.sent.length = 0;
    ctx.alimtalk.sent.length = 0;

    const shared = await share(graduated, id).expect(200);
    expect(shared.body).toEqual({
      contact_shared_at: expect.any(String),
      shared_email: GRADUATED_EMAIL,
      shared_phone: "01011112222",
    });

    expect(await sentDetail(student, id)).toMatchObject({
      status: "contact_shared",
      shared_contact: {
        name: GRADUATED_NAME,
        email: GRADUATED_EMAIL,
        phone: "01011112222",
        shared_at: shared.body.contact_shared_at,
      },
    });
    expect((await receivedList(graduated)).items[0].status).toBe(
      "contact_shared",
    );

    await waitUntil(
      () => ctx.mail.sent.length === 1 && ctx.alimtalk.sent.length === 1,
    );
    expect(ctx.mail.sent[0].to).toBe(STUDENT_EMAIL);
    expect(ctx.mail.sent[0].text).toContain(
      `${STUDENT_NAME}님, ${GRADUATED_NAME}님이`,
    );
    expect(ctx.alimtalk.sent[0]).toEqual({
      event: "contact_shared",
      to: STUDENT_PHONE,
      variables: {
        recipientName: STUDENT_NAME,
        graduatedName: GRADUATED_NAME,
        coffeeChatRequestPk: id,
      },
    });
  });

  it("다시 공유하면 처음 결과를 그대로 주고 알림을 다시 보내지 않음. 이후 연락처를 바꿔도 처음 값", async () => {
    const graduated = await signupGraduated(ctx);
    const student = await signupStudent(ctx);
    const id = await sendRequest(student, graduated);

    const first = await share(graduated, id).expect(200);
    await waitUntil(() => ctx.mail.sent.some((m) => m.to === STUDENT_EMAIL));
    const mailCount = ctx.mail.sent.length;

    const { id: graduatedUserPk } = await getInfo(ctx, graduated);
    await ctx.db
      .update(coffeeChatContact)
      .set({ email: "changed@example.com" })
      .where(eq(coffeeChatContact.userPk, graduatedUserPk));

    const again = await share(graduated, id).expect(200);
    expect(again.body).toEqual(first.body);
    expect((await sentDetail(student, id)).shared_contact.email).toBe(
      GRADUATED_EMAIL,
    );
    // 알림이 비동기로 나갈 틈을 준 뒤에도 늘지 않음
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(ctx.mail.sent).toHaveLength(mailCount);
  });

  it("연락 희망을 끈 현업자는 공유할 연락처가 없어 409이고 상태가 그대로", async () => {
    const graduated = await signupGraduated(ctx);
    const student = await signupStudent(ctx);
    const id = await sendRequest(student, graduated);

    const { id: graduatedUserPk } = await getInfo(ctx, graduated);
    await ctx.db
      .update(coffeeChatContact)
      .set({ emailEnabled: false, email: null })
      .where(eq(coffeeChatContact.userPk, graduatedUserPk));

    await share(graduated, id).expect(409);
    expect((await requestRow(id)).contactSharedAt).toBeNull();
    expect((await sentDetail(student, id)).shared_contact).toBeNull();
  });

  it("다른 현업자가 받은 요청은 404, id 형식 오류는 400, 재학생 토큰은 403", async () => {
    const graduated = await signupGraduated(ctx);
    const other = await signupGraduated(ctx);
    const student = await signupStudent(ctx);
    const id = await sendRequest(student, graduated);

    await detail(other, id).expect(404);
    await share(other, id).expect(404);
    expect((await receivedList(other)).total).toBe(0);
    expect((await requestRow(id)).graduatedViewedAt).toBeNull();

    await detail(graduated, "not-a-uuid").expect(400);
    await share(graduated, "not-a-uuid").expect(400);

    await http(ctx)
      .get(RECEIVED)
      .set("Authorization", bearer(student))
      .expect(403);
    await detail(student, id).expect(403);
    await share(student, id).expect(403);
  });

  it("재학생이 탈퇴하면 목록에서 가려지고 상세 · 공유는 410. 이미 공유한 요청은 공유 결과를 그대로 줌", async () => {
    const graduated = await signupGraduated(ctx);
    const sharedStudent = await signupStudent(ctx);
    const pendingStudent = await signupStudent(ctx);
    const sharedId = await sendRequest(sharedStudent, graduated);
    const pendingId = await sendRequest(pendingStudent, graduated);
    const first = await share(graduated, sharedId).expect(200);

    await withdraw(sharedStudent);
    await withdraw(pendingStudent);

    const list = await receivedList(graduated);
    expect(list.items).toHaveLength(2);
    for (const item of list.items) {
      expect(item).toMatchObject({
        student_name: "탈퇴한 학생의 신청서입니다",
        student_withdrawn: true,
      });
    }

    await detail(graduated, pendingId).expect(410);
    await share(graduated, pendingId).expect(410);
    expect(await requestRow(pendingId)).toMatchObject({
      graduatedViewedAt: null,
      contactSharedAt: null,
    });

    await detail(graduated, sharedId).expect(410);
    expect((await share(graduated, sharedId).expect(200)).body).toEqual(
      first.body,
    );
  });

  it("받은 요청 목록은 최근 요청 순이고 page · size로 나눔", async () => {
    const graduated = await signupGraduated(ctx);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const student = await signupStudent(ctx);
      ids.push(await sendRequest(student, graduated, `질문 ${i}`));
    }

    const first = await receivedList(graduated, { page: 1, size: 2 });
    expect(first).toMatchObject({ page: 1, size: 2, total: 3 });
    const second = await receivedList(graduated, { page: 2, size: 2 });
    expect(second.items).toHaveLength(1);
    expect(
      [...first.items, ...second.items].map((item: { id: string }) => item.id),
    ).toEqual([...ids].reverse());

    await http(ctx)
      .get(RECEIVED)
      .query({ size: 0 })
      .set("Authorization", bearer(graduated))
      .expect(400);
  });
});
