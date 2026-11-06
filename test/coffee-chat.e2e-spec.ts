import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { coffeeChatContact } from "@drizzle/schema/coffee-chat-contact";
import { notificationLog } from "@drizzle/schema/notification-log";
import { CheersNotificationRetryService } from "@src/cheers/cheers-notification-retry.service";
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

// graduatedInfoBody의 연락처
const GRADUATED_CONTACT_EMAIL = "graduated-contact@example.com";

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
      ctx.mail.sent.some((m) => m.to === GRADUATED_CONTACT_EMAIL),
    );
  });

  describe("알림 결과 기록", () => {
    // 요청을 보내고 notification_log 행이 생길 때까지 기다림 (응답 뒤에 비동기로 기록)
    const requestAndWaitForLog = async () => {
      await signupGraduated(ctx);
      const studentSession = await signupStudent(ctx);
      const card = (await list(studentSession)).items[0];
      const created = await http(ctx)
        .post("/api/v1/cheers/request")
        .set("Authorization", bearer(studentSession))
        .send({ graduated_id: card.graduated_id, message: "질문" })
        .expect(201);

      let rows: (typeof notificationLog.$inferSelect)[] = [];
      await waitUntil(async () => {
        rows = await ctx.db.select().from(notificationLog);
        return rows.length > 0;
      });
      return { requestId: created.body.id, rows };
    };

    it("발송에 성공하면 notification_log에 sent로 남음", async () => {
      ctx.mail.sendResult = { success: true, messageId: "e2e-message-id" };

      const { requestId, rows } = await requestAndWaitForLog();

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        coffeeChatRequestPk: requestId,
        event: "coffee_chat_requested",
        channel: "email",
        status: "sent",
        recipient: GRADUATED_CONTACT_EMAIL,
        providerMessageId: "e2e-message-id",
      });
      expect(ctx.slack.messages).toHaveLength(0);
    });

    it("발송에 실패하면 failed로 남고 1분 뒤 재시도 대상이 됨. 처음 실패는 Slack으로 알리지 않음 (CRB-75)", async () => {
      ctx.mail.sendResult = {
        success: false,
        error: `SMTP error for ${GRADUATED_CONTACT_EMAIL}`,
      };
      const before = Date.now();

      const { requestId, rows } = await requestAndWaitForLog();

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        coffeeChatRequestPk: requestId,
        status: "failed",
        attempt: 1,
      });
      const retryAt = rows[0].nextRetryAt!.getTime();
      expect(retryAt).toBeGreaterThanOrEqual(before + 60_000);
      expect(retryAt).toBeLessThanOrEqual(Date.now() + 60_000);
      expect(ctx.slack.messages).toHaveLength(0);
    });

    describe("알림톡 (가짜 알리고)", () => {
      const PHONE = "01011112222";

      // 메일 · 알림톡을 모두 고른 현업자에게 요청. 두 채널의 기록이 다 생길 때까지 기다림
      const requestWithKakao = async (expectedRows: number) => {
        await signupGraduated(ctx, {
          contact: {
            email_enabled: true,
            kakao_enabled: true,
            email: GRADUATED_CONTACT_EMAIL,
            phone: "010-1111-2222",
          },
        });
        const studentSession = await signupStudent(ctx);
        const card = (await list(studentSession)).items[0];
        const created = await http(ctx)
          .post("/api/v1/cheers/request")
          .set("Authorization", bearer(studentSession))
          .send({ graduated_id: card.graduated_id, message: "질문" })
          .expect(201);

        await waitUntil(
          () =>
            ctx.mail.sent.some((m) => m.to === GRADUATED_CONTACT_EMAIL) &&
            ctx.alimtalk.sent.length === 1,
        );
        let rows: (typeof notificationLog.$inferSelect)[] = [];
        await waitUntil(async () => {
          rows = await ctx.db.select().from(notificationLog);
          return rows.length >= expectedRows;
        });
        return { requestId: created.body.id as string, rows };
      };
      const byChannel = (rows: (typeof notificationLog.$inferSelect)[]) =>
        Object.fromEntries(rows.map((row) => [row.channel, row]));

      it("알리고 대신 가짜 서비스로 현업자 번호 · 이름 · 요청 id를 넘기고, 두 채널을 따로 기록", async () => {
        ctx.mail.sendResult = { success: true, messageId: "mail-id" };
        ctx.alimtalk.sendResult = { success: true, messageId: "aligo-mid" };

        const { requestId, rows } = await requestWithKakao(2);

        expect(ctx.alimtalk.sent).toEqual([
          {
            event: "coffee_chat_requested",
            to: PHONE,
            variables: {
              recipientName: "박현업",
              coffeeChatRequestPk: requestId,
            },
          },
        ]);
        expect(rows).toHaveLength(2);
        expect(byChannel(rows)).toMatchObject({
          email: { status: "sent", providerMessageId: "mail-id" },
          kakao_alimtalk: {
            coffeeChatRequestPk: requestId,
            event: "coffee_chat_requested",
            status: "sent",
            recipient: PHONE,
            providerMessageId: "aligo-mid",
          },
        });
        expect(ctx.slack.messages).toHaveLength(0);
      });

      it("알림톡이 실패해도 메일은 sent이고, 알림톡만 재시도 대상이 됨", async () => {
        ctx.mail.sendResult = { success: true, messageId: "mail-id" };
        ctx.alimtalk.sendResult = {
          success: false,
          error: `-99 invalid receiver ${PHONE}`,
        };

        const { rows } = await requestWithKakao(2);

        expect(byChannel(rows)).toMatchObject({
          email: { status: "sent", nextRetryAt: null },
          kakao_alimtalk: { status: "failed", attempt: 1 },
        });
        expect(byChannel(rows).kakao_alimtalk.nextRetryAt).not.toBeNull();
        expect(ctx.slack.messages).toHaveLength(0);
      });

      describe("재시도 스케줄러 (CRB-75)", () => {
        const MINUTE_MS = 60 * 1000;
        // 스케줄러 대신 서비스를 직접 호출. 재시도 시각이 지나도록 now를 앞으로 당김
        const retryAfter = (ms: number) =>
          ctx.app
            .get(CheersNotificationRetryService)
            .retryDue(new Date(Date.now() + ms));
        const kakaoLogs = () =>
          ctx.db
            .select()
            .from(notificationLog)
            .where(eq(notificationLog.channel, "kakao_alimtalk"))
            .orderBy(asc(notificationLog.attempt));

        beforeEach(() => {
          ctx.mail.sendResult = { success: true, messageId: "mail-id" };
          ctx.alimtalk.sendResult = { success: false, error: "-99 failed" };
        });

        it("시각이 되기 전에는 보내지 않고, 다시 보내 성공하면 새 행을 남기고 재시도를 끝냄", async () => {
          const { requestId } = await requestWithKakao(2);

          await expect(retryAfter(0)).resolves.toMatchObject({ sent: 0 });
          expect(ctx.alimtalk.sent).toHaveLength(1);

          ctx.alimtalk.sendResult = { success: true, messageId: "aligo-2" };
          await expect(retryAfter(2 * MINUTE_MS)).resolves.toEqual({
            sent: 1,
            failed: 0,
            gaveUp: 0,
            dropped: 0,
          });

          // 실패한 채널(알림톡)만 다시 보냄
          expect(
            ctx.mail.sent.filter((m) => m.to === GRADUATED_CONTACT_EMAIL),
          ).toHaveLength(1);
          expect(ctx.alimtalk.sent).toHaveLength(2);
          expect(ctx.alimtalk.sent[1]).toEqual(ctx.alimtalk.sent[0]);
          expect(await kakaoLogs()).toMatchObject([
            { status: "failed", attempt: 1, nextRetryAt: null },
            {
              coffeeChatRequestPk: requestId,
              status: "sent",
              attempt: 2,
              nextRetryAt: null,
              providerMessageId: "aligo-2",
            },
          ]);
          // 다시 돌려도 보낼 것이 없음
          await expect(retryAfter(60 * MINUTE_MS)).resolves.toMatchObject({
            sent: 0,
            failed: 0,
          });
        });

        it("1분 · 5분 · 30분 뒤 3번 재시도하고, 모두 실패하면 Slack으로 알리고 그만둠", async () => {
          await requestWithKakao(2);

          await expect(retryAfter(2 * MINUTE_MS)).resolves.toMatchObject({
            failed: 1,
          });
          // 2번째 실패의 다음 시도는 5분 뒤
          await expect(retryAfter(4 * MINUTE_MS)).resolves.toMatchObject({
            failed: 0,
          });
          await expect(retryAfter(6 * MINUTE_MS)).resolves.toMatchObject({
            failed: 1,
          });
          await expect(retryAfter(31 * MINUTE_MS)).resolves.toMatchObject({
            gaveUp: 1,
          });

          const logs = await kakaoLogs();
          expect(logs.map((log) => [log.attempt, log.status])).toEqual([
            [1, "failed"],
            [2, "failed"],
            [3, "failed"],
            [4, "failed"],
          ]);
          expect(logs.every((log) => log.nextRetryAt === null)).toBe(true);
          expect(ctx.alimtalk.sent).toHaveLength(4);
          expect(ctx.slack.messages).toHaveLength(1);
          expect(ctx.slack.messages[0]).toContain("NOTIFICATION GAVE UP");
          expect(ctx.slack.messages[0]).not.toContain(PHONE);

          await expect(retryAfter(120 * MINUTE_MS)).resolves.toMatchObject({
            failed: 0,
            gaveUp: 0,
          });
        });

        it("받는 사람이 그 채널을 끄면 보내지 않고 재시도를 그만둠", async () => {
          await requestWithKakao(2);
          await ctx.db.update(coffeeChatContact).set({ kakaoEnabled: false });

          await expect(retryAfter(2 * MINUTE_MS)).resolves.toMatchObject({
            dropped: 1,
          });
          expect(ctx.alimtalk.sent).toHaveLength(1);
          expect(await kakaoLogs()).toMatchObject([
            { attempt: 1, nextRetryAt: null },
          ]);
        });
      });

      it("키가 없을 때처럼 skipped면 호출은 하지만 기록을 남기지 않음", async () => {
        await requestWithKakao(0);
        // 비동기 기록이 끝날 틈을 줌
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(await ctx.db.select().from(notificationLog)).toHaveLength(0);
      });
    });
  });

  it("현업자는 목록만 볼 수 있고 요청 · 보낸 요청 API는 호출할 수 없음", async () => {
    const graduatedSession = await signupGraduated(ctx);

    const page = await http(ctx)
      .get("/api/v1/cheers")
      .set("Authorization", bearer(graduatedSession))
      .expect(200);
    expect(page.body.total).toBe(1);
    await http(ctx)
      .post("/api/v1/cheers/request")
      .set("Authorization", bearer(graduatedSession))
      .send({ graduated_id: page.body.items[0].graduated_id, message: "질문" })
      .expect(403);
    await http(ctx)
      .get("/api/v1/cheers/sent")
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
