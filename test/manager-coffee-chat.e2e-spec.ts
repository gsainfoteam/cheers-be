import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { adminAccount } from "@drizzle/schema/admin-account";
import { coffeeChatRequest } from "@drizzle/schema/coffee-chat-request";
import { notificationLog } from "@drizzle/schema/notification-log";
import { student } from "@drizzle/schema/student";
import { users } from "@drizzle/schema/users";
import { createE2eApp, E2eContext } from "./support/app";
import {
  bearer,
  http,
  Session,
  signupGraduated,
  signupStudent,
} from "./support/flows";

const REQUESTS = "/api/manager/v1/coffee-chat/request";
const LOGS = "/api/manager/v1/coffee-chat/notification-log";

const ADMIN = "admin@gm.gist.ac.kr";
const SUPER = "super@gm.gist.ac.kr";
const CONTACT_EMAIL = "graduated-contact@example.com";
const CONTACT_PHONE = "01098765432";

describe("어드민 커피챗 요청 관리", () => {
  let ctx: E2eContext;
  let auth: string;

  const managerAuth = async (
    email: string,
    role: "admin" | "superadmin",
  ): Promise<string> => {
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

  const signupGraduatedWithPhone = (nickname: string) =>
    signupGraduated(ctx, {
      nickname,
      contact: {
        email_enabled: true,
        kakao_enabled: true,
        email: CONTACT_EMAIL,
        phone: CONTACT_PHONE,
      },
    });

  const graduatedIdOf = async (studentSession: Session, nickname: string) => {
    const res = await http(ctx)
      .get("/api/v1/cheers")
      .set("Authorization", bearer(studentSession))
      .expect(200);
    return res.body.items.find(
      (card: { nickname: string }) => card.nickname === nickname,
    ).graduated_id;
  };

  const sendRequest = async (
    studentSession: Session,
    graduatedId: string,
    message = "질문 있습니다",
  ): Promise<string> => {
    const res = await http(ctx)
      .post("/api/v1/cheers/request")
      .set("Authorization", bearer(studentSession))
      .send({ graduated_id: graduatedId, message })
      .expect(201);
    return res.body.id;
  };

  const view = (graduatedSession: Session, id: string) =>
    http(ctx)
      .get(`/api/v1/cheers/received/${id}`)
      .set("Authorization", bearer(graduatedSession))
      .expect(200);

  const shareContact = (graduatedSession: Session, id: string) =>
    http(ctx)
      .post(`/api/v1/cheers/received/${id}/share-contact`)
      .set("Authorization", bearer(graduatedSession))
      .expect(200);

  const listRequests = async (query: Record<string, string | number> = {}) =>
    (
      await http(ctx)
        .get(REQUESTS)
        .query(query)
        .set("Authorization", auth)
        .expect(200)
    ).body;

  const pksOf = (body: { items: { pk: string }[] }) =>
    body.items.map((item) => item.pk);

  const seedLog = async (
    coffeeChatRequestPk: string,
    overrides: Partial<typeof notificationLog.$inferInsert> = {},
  ) => {
    const [row] = await ctx.db
      .insert(notificationLog)
      .values({
        pk: randomUUID(),
        coffeeChatRequestPk,
        event: "coffee_chat_requested",
        channel: "email",
        status: "sent",
        recipient: CONTACT_EMAIL,
        ...overrides,
      })
      .returning();
    return row;
  };

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  beforeEach(async () => {
    await ctx.reset();
    auth = await managerAuth(ADMIN, "admin");
  });
  afterAll(() => ctx.close());

  describe("권한", () => {
    it("토큰이 없거나 사용자 토큰이면 401", async () => {
      const session = await signupStudent(ctx);
      for (const path of [REQUESTS, `${REQUESTS}/${randomUUID()}`, LOGS]) {
        await http(ctx).get(path).expect(401);
        await http(ctx)
          .get(path)
          .set("Authorization", bearer(session))
          .expect(401);
      }
    });

    it("admin · superadmin 모두 읽을 수 있음", async () => {
      const superAuth = await managerAuth(SUPER, "superadmin");
      for (const authorization of [auth, superAuth]) {
        await http(ctx)
          .get(REQUESTS)
          .set("Authorization", authorization)
          .expect(200);
        await http(ctx)
          .get(LOGS)
          .set("Authorization", authorization)
          .expect(200);
      }
    });
  });

  describe("요청 목록", () => {
    it("상태 필터와 연락처 비노출", async () => {
      const graduatedSession = await signupGraduatedWithPhone("필터현업");
      const studentSession = await signupStudent(ctx);
      const graduatedId = await graduatedIdOf(studentSession, "필터현업");
      const requested = await sendRequest(studentSession, graduatedId);
      const viewed = await sendRequest(studentSession, graduatedId);
      const shared = await sendRequest(studentSession, graduatedId);
      await view(graduatedSession, viewed);
      await view(graduatedSession, shared);
      await shareContact(graduatedSession, shared);

      // 공유가 실제로 저장된 상태에서 응답에 없는지 확인
      const [stored] = await ctx.db
        .select()
        .from(coffeeChatRequest)
        .where(eq(coffeeChatRequest.pk, shared));
      expect(stored.sharedEmail).toBe(CONTACT_EMAIL);
      expect(stored.sharedPhone).toBe(CONTACT_PHONE);

      const all = await listRequests();
      expect(all.total).toBe(3);
      expect(pksOf(all).sort()).toEqual([requested, viewed, shared].sort());
      const item = all.items.find((i: { pk: string }) => i.pk === shared);
      expect(item).toMatchObject({
        status: "contact_shared",
        student: { name: "김재학", active: true },
        graduated: {
          pk: graduatedId,
          nickname: "필터현업",
          company: "인포테크",
          active: true,
        },
        graduated_viewed_at: expect.any(String),
        contact_shared_at: expect.any(String),
      });
      expect(item).not.toHaveProperty("message");
      const raw = JSON.stringify(all);
      expect(raw).not.toContain("shared_email");
      expect(raw).not.toContain("shared_phone");
      expect(raw).not.toContain(CONTACT_EMAIL);
      expect(raw).not.toContain(CONTACT_PHONE);

      expect(pksOf(await listRequests({ status: "requested" }))).toEqual([
        requested,
      ]);
      expect(pksOf(await listRequests({ status: "viewed" }))).toEqual([viewed]);
      expect(pksOf(await listRequests({ status: "contact_shared" }))).toEqual([
        shared,
      ]);
    });

    it("기간 필터는 시작 포함, 끝 미포함", async () => {
      await signupGraduatedWithPhone("기간현업");
      const studentSession = await signupStudent(ctx);
      const graduatedId = await graduatedIdOf(studentSession, "기간현업");
      const pk = await sendRequest(studentSession, graduatedId);
      const at = "2026-10-15T00:00:00.000Z";
      await ctx.db
        .update(coffeeChatRequest)
        .set({ createdAt: new Date(at) })
        .where(eq(coffeeChatRequest.pk, pk));

      expect(pksOf(await listRequests({ created_from: at }))).toEqual([pk]);
      expect(pksOf(await listRequests({ created_to: at }))).toEqual([]);
      expect(
        pksOf(
          await listRequests({
            created_from: "2026-10-14T00:00:00+09:00",
            created_to: "2026-10-16T00:00:00+09:00",
          }),
        ),
      ).toEqual([pk]);
    });

    it("재학생 · 현업자 기준 필터. 검색어의 %, _는 글자 그대로", async () => {
      await signupGraduatedWithPhone("가나현업");
      await signupGraduatedWithPhone("다라현업");
      const studentSession = await signupStudent(ctx);
      const other = await signupStudent(ctx);
      const ga = await graduatedIdOf(studentSession, "가나현업");
      const da = await graduatedIdOf(studentSession, "다라현업");
      const first = await sendRequest(studentSession, ga);
      const second = await sendRequest(other, da);
      const [otherStudent] = await ctx.db
        .select({ pk: student.pk, userPk: student.userPk })
        .from(coffeeChatRequest)
        .innerJoin(student, eq(student.pk, coffeeChatRequest.studentPk))
        .where(eq(coffeeChatRequest.pk, second));
      await ctx.db
        .update(users)
        .set({ name: "이학생" })
        .where(eq(users.pk, otherStudent.userPk));

      expect(pksOf(await listRequests({ graduated_pk: ga }))).toEqual([first]);
      expect(
        pksOf(await listRequests({ student_pk: otherStudent.pk })),
      ).toEqual([second]);
      expect(pksOf(await listRequests({ student_name: " 이학 " }))).toEqual([
        second,
      ]);
      expect(pksOf(await listRequests({ graduated_nickname: "가나" }))).toEqual(
        [first],
      );
      expect(pksOf(await listRequests({ student_name: "%" }))).toEqual([]);
      expect(pksOf(await listRequests({ graduated_nickname: "_" }))).toEqual(
        [],
      );
      expect(
        pksOf(await listRequests({ graduated_pk: ga, student_name: "이학" })),
      ).toEqual([]);
    });

    it("페이지네이션: 최근 요청 순, total은 필터 적용 전체", async () => {
      await signupGraduatedWithPhone("페이지현업");
      const studentSession = await signupStudent(ctx);
      const graduatedId = await graduatedIdOf(studentSession, "페이지현업");
      const pks: string[] = [];
      for (const day of [1, 2, 3]) {
        const pk = await sendRequest(studentSession, graduatedId);
        await ctx.db
          .update(coffeeChatRequest)
          .set({ createdAt: new Date(`2026-10-0${day}T00:00:00Z`) })
          .where(eq(coffeeChatRequest.pk, pk));
        pks.push(pk);
      }

      const first = await listRequests({ page: 1, size: 2 });
      expect(first).toMatchObject({ page: 1, size: 2, total: 3 });
      expect(pksOf(first)).toEqual([pks[2], pks[1]]);

      const second = await listRequests({ page: 2, size: 2 });
      expect(second).toMatchObject({ page: 2, size: 2, total: 3 });
      expect(pksOf(second)).toEqual([pks[0]]);

      const beyond = await listRequests({ page: 3, size: 2 });
      expect(beyond).toMatchObject({ items: [], total: 3 });
    });

    it("탈퇴 처리된 재학생도 pk로 찾고, 이름 검색에는 걸리지 않음", async () => {
      await signupGraduatedWithPhone("탈퇴현업");
      const studentSession = await signupStudent(ctx);
      const pk = await sendRequest(
        studentSession,
        await graduatedIdOf(studentSession, "탈퇴현업"),
      );
      const [row] = await ctx.db
        .select({ studentPk: student.pk, userPk: student.userPk })
        .from(student);
      await ctx.db
        .update(users)
        .set({ name: null, email: null, isDeleted: true })
        .where(eq(users.pk, row.userPk));

      const found = await listRequests({ student_pk: row.studentPk });
      expect(pksOf(found)).toEqual([pk]);
      expect(found.items[0].student).toMatchObject({
        name: null,
        active: false,
      });
      expect(pksOf(await listRequests({ student_name: "김재학" }))).toEqual([]);
    });

    it("잘못된 query는 400", async () => {
      for (const query of [
        { status: "unknown" },
        { created_from: "yesterday" },
        { created_from: "2026-02-30T00:00:00Z" },
        { student_pk: "not-a-uuid" },
        { graduated_pk: "not-a-uuid" },
        { student_name: "   " },
        { graduated_nickname: "가".repeat(33) },
        { page: 0 },
        { size: 51 },
        {
          created_from: "2026-11-01T00:00:00Z",
          created_to: "2026-10-01T00:00:00Z",
        },
      ]) {
        await http(ctx)
          .get(REQUESTS)
          .query(query)
          .set("Authorization", auth)
          .expect(400);
      }
    });
  });

  describe("요청 상세", () => {
    it("메시지 · 열람 · 공유 시각과 발송 결과. 연락처는 내려주지 않음", async () => {
      const graduatedSession = await signupGraduatedWithPhone("상세현업");
      const studentSession = await signupStudent(ctx);
      const pk = await sendRequest(
        studentSession,
        await graduatedIdOf(studentSession, "상세현업"),
        "포트폴리오 봐 주세요",
      );
      await view(graduatedSession, pk);
      await shareContact(graduatedSession, pk);
      await http(ctx)
        .get(`/api/v1/cheers/sent/${pk}`)
        .set("Authorization", bearer(studentSession))
        .expect(200);
      await seedLog(pk, {
        channel: "kakao_alimtalk",
        status: "failed",
        recipient: CONTACT_PHONE,
        error: `-99 invalid receiver ${CONTACT_PHONE}`,
      });

      const res = await http(ctx)
        .get(`${REQUESTS}/${pk}`)
        .set("Authorization", auth)
        .expect(200);

      expect(res.body).toMatchObject({
        pk,
        status: "contact_shared",
        message: "포트폴리오 봐 주세요",
        graduated_viewed_at: expect.any(String),
        contact_shared_at: expect.any(String),
        student_viewed_at: expect.any(String),
      });
      expect(res.body.notifications).toEqual([
        {
          pk: expect.any(String),
          event: "coffee_chat_requested",
          channel: "kakao_alimtalk",
          status: "failed",
          error: "-99 invalid receiver 010****5432",
          created_at: expect.any(String),
        },
      ]);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain("shared_email");
      expect(raw).not.toContain("shared_phone");
      expect(raw).not.toContain("recipient");
      expect(raw).not.toContain(CONTACT_EMAIL);
      expect(raw).not.toContain(CONTACT_PHONE);
    });

    it("없는 요청은 404, 형식 오류는 400", async () => {
      await http(ctx)
        .get(`${REQUESTS}/${randomUUID()}`)
        .set("Authorization", auth)
        .expect(404);
      await http(ctx)
        .get(`${REQUESTS}/not-a-uuid`)
        .set("Authorization", auth)
        .expect(400);
    });
  });

  describe("알림 발송 결과", () => {
    it("필터 · 페이지네이션 · 수신자와 실패 사유 가림", async () => {
      await signupGraduatedWithPhone("로그현업");
      const studentSession = await signupStudent(ctx);
      const pk = await sendRequest(
        studentSession,
        await graduatedIdOf(studentSession, "로그현업"),
      );
      const sent = await seedLog(pk, {
        createdAt: new Date("2026-10-01T00:00:00Z"),
      });
      const failed = await seedLog(pk, {
        status: "failed",
        event: "contact_shared",
        createdAt: new Date("2026-10-02T00:00:00Z"),
        error: `550 rejected <${CONTACT_EMAIL.toUpperCase()}>`,
      });
      const kakao = await seedLog(pk, {
        channel: "kakao_alimtalk",
        status: "failed",
        recipient: CONTACT_PHONE,
        createdAt: new Date("2026-10-03T00:00:00Z"),
        error: "-99 invalid receiver 010-9876-5432",
      });

      const list = async (query: Record<string, string | number> = {}) =>
        (
          await http(ctx)
            .get(LOGS)
            .query(query)
            .set("Authorization", auth)
            .expect(200)
        ).body;

      const all = await list();
      expect(all.total).toBe(3);
      expect(pksOf(all)).toEqual([kakao.pk, failed.pk, sent.pk]);
      expect(all.items[0]).toEqual({
        pk: kakao.pk,
        coffee_chat_request_pk: pk,
        event: "coffee_chat_requested",
        channel: "kakao_alimtalk",
        status: "failed",
        error: "-99 invalid receiver 010****5432",
        created_at: "2026-10-03T00:00:00.000Z",
      });
      expect(all.items[1].error).toBe("550 rejected <GR***@EXAMPLE.COM>");
      expect(all.items[2].error).toBeNull();
      const raw = JSON.stringify(all);
      expect(raw).not.toContain("recipient");
      expect(raw.toLowerCase()).not.toContain(CONTACT_EMAIL);
      expect(raw).not.toContain(CONTACT_PHONE);
      expect(raw).not.toContain("9876");

      expect(pksOf(await list({ status: "sent" }))).toEqual([sent.pk]);
      expect(pksOf(await list({ channel: "kakao_alimtalk" }))).toEqual([
        kakao.pk,
      ]);
      expect(pksOf(await list({ event: "contact_shared" }))).toEqual([
        failed.pk,
      ]);
      expect(
        pksOf(
          await list({
            created_from: "2026-10-02T00:00:00Z",
            created_to: "2026-10-03T00:00:00Z",
          }),
        ),
      ).toEqual([failed.pk]);

      const page = await list({ page: 2, size: 2 });
      expect(page).toMatchObject({ page: 2, size: 2, total: 3 });
      expect(pksOf(page)).toEqual([sent.pk]);
    });

    it("잘못된 query는 400", async () => {
      for (const query of [
        { channel: "sms" },
        { status: "unknown" },
        { event: "unknown" },
        { created_to: "tomorrow" },
      ]) {
        await http(ctx)
          .get(LOGS)
          .query(query)
          .set("Authorization", auth)
          .expect(400);
      }
    });
  });

  it("읽기만 하므로 요청 상태가 바뀌지 않음", async () => {
    await signupGraduatedWithPhone("읽기현업");
    const studentSession = await signupStudent(ctx);
    const pk = await sendRequest(
      studentSession,
      await graduatedIdOf(studentSession, "읽기현업"),
    );

    await http(ctx)
      .get(`${REQUESTS}/${pk}`)
      .set("Authorization", auth)
      .expect(200);

    const [stored] = await ctx.db
      .select({ graduatedViewedAt: coffeeChatRequest.graduatedViewedAt })
      .from(coffeeChatRequest)
      .where(eq(coffeeChatRequest.pk, pk));
    expect(stored.graduatedViewedAt).toBeNull();
  });
});
