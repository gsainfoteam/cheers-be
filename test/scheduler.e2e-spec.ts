import { SchedulerRegistry } from "@nestjs/schedule";
import { eq } from "drizzle-orm";
import { coffeeChatContact } from "@drizzle/schema/coffee-chat-contact";
import { coffeeChatRequest } from "@drizzle/schema/coffee-chat-request";
import { graduated } from "@drizzle/schema/graduated";
import { refreshToken } from "@drizzle/schema/refresh-token";
import { student } from "@drizzle/schema/student";
import { studentEmailSendLog } from "@drizzle/schema/student-email-send-log";
import { studentEmailVerification } from "@drizzle/schema/student-email-verification";
import { studentProfileAttachment } from "@drizzle/schema/student-profile-attachment";
import { userConsent } from "@drizzle/schema/user-consent";
import { userOauthAccount } from "@drizzle/schema/user-oauth-account";
import { users } from "@drizzle/schema/users";
import { CleanupService } from "@src/user/cleanup.service";
import { WithdrawalService } from "@src/user/withdrawal.service";
import { createE2eApp, E2eContext } from "./support/app";
import {
  agreeConsents,
  bearer,
  getInfo,
  http,
  login,
  saveStudentInfo,
  sendCode,
  Session,
  signupGraduated,
  signupStudent,
  submitBusinessCard,
  uploadAttachment,
  verifyStudentEmail,
} from "./support/flows";

const SECOND_MS = 1000;
const HOUR_MS = 60 * 60 * SECOND_MS;
const DAY_MS = 24 * HOUR_MS;

describe("시나리오 4: 스케줄러 작업", () => {
  let ctx: E2eContext;
  let cleanup: CleanupService;
  let withdrawal: WithdrawalService;
  const now = new Date("2026-10-31T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  const userPkOf = async (session: Session): Promise<string> =>
    (await getInfo(ctx, session)).id;

  // getInfo가 last_active_at을 갱신하므로 pk를 구한 뒤에 호출
  const ageUser = (pk: string, at: Date) =>
    ctx.db
      .update(users)
      .set({ createdAt: at, lastActiveAt: at })
      .where(eq(users.pk, pk));

  const withdraw = async (session: Session, at: Date): Promise<string> => {
    const pk = await userPkOf(session);
    await http(ctx)
      .post("/api/v1/user/withdraw")
      .set("Authorization", bearer(session))
      .expect(201);
    await ctx.db
      .update(users)
      .set({ withdrawRequestedAt: at })
      .where(eq(users.pk, pk));
    return pk;
  };

  const findUser = async (pk: string) =>
    (await ctx.db.select().from(users).where(eq(users.pk, pk)))[0];

  beforeAll(async () => {
    ctx = await createE2eApp();
    cleanup = ctx.app.get(CleanupService);
    withdrawal = ctx.app.get(WithdrawalService);
  });
  beforeEach(() => ctx.reset());
  afterAll(() => ctx.close());

  describe("cron 등록", () => {
    it.each([
      ["incomplete-signup-purge", "0 0 3 * * *"],
      ["expired-data-purge", "0 30 3 * * *"],
      ["withdrawal-purge", "0 0 4 * * *"],
      ["orphan-file-cleanup", "0 30 4 * * 0"],
    ])(
      "%s는 %s(KST)에 등록되고 테스트 중에는 멈춰 있음",
      (name, expression) => {
        const job = ctx.app.get(SchedulerRegistry).getCronJob(name);

        expect(job.cronTime.source).toBe(expression);
        expect(job.cronTime.timeZone).toBe("Asia/Seoul");
        expect(job.isActive).toBe(false);
      },
    );
  });

  describe("가입 미완료 정리", () => {
    it("자식 행이 있는 pending 재학생을 FK 오류 없이 지움", async () => {
      const email = "purge-student@gm.gist.ac.kr";
      const verified = await login(ctx, "student");
      await agreeConsents(ctx, verified);
      await verifyStudentEmail(ctx, verified, email);
      const pk = await userPkOf(verified);

      const inProgress = await login(ctx, "student");
      await agreeConsents(ctx, inProgress);
      await sendCode(ctx, inProgress, "purge-progress@gm.gist.ac.kr");
      const inProgressPk = await userPkOf(inProgress);

      await ageUser(pk, ago(2 * DAY_MS));
      await ageUser(inProgressPk, ago(2 * DAY_MS));

      expect(await cleanup.purgeIncompleteSignups(now)).toBe(2);

      for (const table of [
        users,
        student,
        userOauthAccount,
        refreshToken,
        userConsent,
        studentEmailSendLog,
        studentEmailVerification,
      ]) {
        expect(await ctx.db.select().from(table)).toHaveLength(0);
      }
      expect(ctx.slack.messages).toHaveLength(0);

      // 지운 이메일은 다른 계정이 다시 인증할 수 있음
      const next = await login(ctx, "student");
      await agreeConsents(ctx, next);
      await verifyStudentEmail(ctx, next, email);
    });

    it("pending 현업자의 명함 파일을 DB 커밋 뒤에 지움", async () => {
      const session = await login(ctx, "graduated");
      await agreeConsents(ctx, session);
      await submitBusinessCard(ctx, session);
      const pk = await userPkOf(session);
      const [row] = await ctx.db
        .select()
        .from(graduated)
        .where(eq(graduated.userPk, pk));
      const key = row.businessCardKey as string;
      expect(ctx.s3.objects.has(key)).toBe(true);

      let usersAtDelete = -1;
      ctx.s3.onDelete = async () => {
        usersAtDelete = (await ctx.db.select().from(users)).length;
      };
      await ageUser(pk, ago(2 * DAY_MS));
      ctx.s3.clearDeleteLog();

      expect(await cleanup.purgeIncompleteSignups(now)).toBe(1);

      expect(usersAtDelete).toBe(0);
      expect(ctx.s3.deletedKeys).toEqual([key]);
      expect(await ctx.db.select().from(graduated)).toHaveLength(0);
    });

    it("보존 기간 경계값: 정확히 24시간은 지우고 그보다 최근과 active는 남김", async () => {
      const due = await login(ctx, "student");
      const recent = await login(ctx, "student");
      const active = await signupStudent(ctx);
      const duePk = await userPkOf(due);
      const recentPk = await userPkOf(recent);
      const activePk = await userPkOf(active);

      await ageUser(duePk, ago(DAY_MS));
      await ageUser(recentPk, ago(DAY_MS - SECOND_MS));
      await ageUser(activePk, ago(30 * DAY_MS));

      expect(await cleanup.purgeIncompleteSignups(now)).toBe(1);

      expect(await findUser(duePk)).toBeUndefined();
      expect(await findUser(recentPk)).toBeDefined();
      expect((await findUser(activePk)).status).toBe("active");
    });

    it("오래전에 가입했어도 최근에 활동한 pending 유저는 남김", async () => {
      const session = await login(ctx, "student");
      const pk = await userPkOf(session);
      await ctx.db
        .update(users)
        .set({ createdAt: ago(10 * DAY_MS), lastActiveAt: ago(HOUR_MS) })
        .where(eq(users.pk, pk));

      expect(await cleanup.purgeIncompleteSignups(now)).toBe(0);
      expect(await findUser(pk)).toBeDefined();
    });
  });

  describe("탈퇴 만료 처리", () => {
    it("유예기간이 지난 재학생의 개인정보를 지우고 이메일을 다시 쓸 수 있게 함", async () => {
      const email = "withdraw-student@gm.gist.ac.kr";
      const session = await signupStudent(ctx, email);
      const pk = await withdraw(session, ago(30 * DAY_MS));

      expect(await withdrawal.purgeExpired(now)).toBe(1);

      const row = await findUser(pk);
      expect(row).toMatchObject({ isDeleted: true, name: null, email: null });
      const rows = await Promise.all([
        ctx.db
          .select()
          .from(userOauthAccount)
          .where(eq(userOauthAccount.userPk, pk)),
        ctx.db.select().from(refreshToken).where(eq(refreshToken.userPk, pk)),
        ctx.db
          .select()
          .from(coffeeChatContact)
          .where(eq(coffeeChatContact.userPk, pk)),
        ctx.db
          .select()
          .from(studentEmailSendLog)
          .where(eq(studentEmailSendLog.userPk, pk)),
      ]);
      expect(rows.map((r) => r.length)).toEqual([0, 0, 0, 0]);
      const [studentRow] = await ctx.db
        .select()
        .from(student)
        .where(eq(student.userPk, pk));
      expect(studentRow.email).toBeNull();
      // 약관 동의 이력은 남김
      expect(
        (
          await ctx.db
            .select()
            .from(userConsent)
            .where(eq(userConsent.userPk, pk))
        ).length,
      ).toBeGreaterThan(0);

      // OAuth 연결이 끊겨 새 계정으로 가입되고, 같은 이메일을 인증할 수 있음
      const next = await login(ctx, "student", session.sub);
      expect(await userPkOf(next)).not.toBe(pk);
      await agreeConsents(ctx, next);
      await verifyStudentEmail(ctx, next, email);
    });

    it("현업자의 명함을 DB 커밋 뒤에 지우고 상대방의 커피챗 기록은 남김", async () => {
      const graduatedSession = await signupGraduated(ctx);
      const studentSession = await signupStudent(ctx);
      const page = await http(ctx)
        .get("/api/v1/cheers")
        .set("Authorization", bearer(studentSession))
        .expect(200);
      const created = await http(ctx)
        .post("/api/v1/cheers/request")
        .set("Authorization", bearer(studentSession))
        .send({ graduated_id: page.body.items[0].graduated_id, message: "Q" })
        .expect(201);

      const pk = await withdraw(graduatedSession, ago(31 * DAY_MS));
      const [before] = await ctx.db
        .select()
        .from(graduated)
        .where(eq(graduated.userPk, pk));
      const key = before.businessCardKey as string;
      ctx.s3.clearDeleteLog();

      // 트랜잭션 안에서 지우면 이 조회(다른 연결)에는 아직 커밋 전 값이 보임
      let atDelete: { key: string | null; isDeleted: boolean } | null = null;
      ctx.s3.onDelete = async () => {
        const [row] = await ctx.db
          .select()
          .from(graduated)
          .where(eq(graduated.userPk, pk));
        atDelete = {
          key: row.businessCardKey,
          isDeleted: (await findUser(pk)).isDeleted,
        };
      };

      expect(await withdrawal.purgeExpired(now)).toBe(1);

      expect(atDelete).toEqual({ key: null, isDeleted: true });
      expect(ctx.s3.deletedKeys).toEqual([key]);
      expect(ctx.s3.objects.has(key)).toBe(false);

      expect(await ctx.db.select().from(coffeeChatRequest)).toHaveLength(1);
      const sent = await http(ctx)
        .get(`/api/v1/cheers/sent/${created.body.id}`)
        .set("Authorization", bearer(studentSession))
        .expect(200);
      expect(sent.body.graduated_withdrawn).toBe(true);
    });

    it("재학생의 첨부 파일을 DB 커밋 뒤에 지우고 링크 첨부는 남김", async () => {
      const session = await signupStudent(ctx);
      const tempKey = await uploadAttachment(ctx, session);
      const linkUrl = "https://example.com/portfolio";
      await saveStudentInfo(ctx, session, {
        attachments: [
          { kind: "cv", source: "file", key: tempKey, file_name: "cv.pdf" },
          { kind: "portfolio", source: "link", url: linkUrl },
        ],
      });
      const info = await getInfo(ctx, session);
      const fileKey = info.student.profile.attachments.find(
        (a: { source: string }) => a.source === "file",
      ).key as string;
      expect(ctx.s3.objects.has(fileKey)).toBe(true);

      await withdraw(session, ago(30 * DAY_MS));
      ctx.s3.clearDeleteLog();

      // 트랜잭션 안에서 지우면 이 조회(다른 연결)에는 아직 파일 행이 보임
      let rowsAtDelete = -1;
      ctx.s3.onDelete = async () => {
        rowsAtDelete = (
          await ctx.db
            .select()
            .from(studentProfileAttachment)
            .where(eq(studentProfileAttachment.source, "file"))
        ).length;
      };

      expect(await withdrawal.purgeExpired(now)).toBe(1);

      expect(rowsAtDelete).toBe(0);
      expect(ctx.s3.deletedKeys).toEqual([fileKey]);
      expect(ctx.s3.objects.has(fileKey)).toBe(false);
      const remaining = await ctx.db.select().from(studentProfileAttachment);
      expect(remaining.map((a) => [a.source, a.url])).toEqual([
        ["link", linkUrl],
      ]);
    });

    it("진행 중인 학교 이메일 인증 요청과 전송 기록을 지움", async () => {
      const email = "withdraw-progress@gm.gist.ac.kr";
      const session = await login(ctx, "student");
      await agreeConsents(ctx, session);
      await sendCode(ctx, session, email);
      expect(await ctx.db.select().from(studentEmailVerification)).toHaveLength(
        1,
      );

      await withdraw(session, ago(DAY_MS));

      expect(await withdrawal.purgeExpired(now)).toBe(1);

      expect(await ctx.db.select().from(studentEmailVerification)).toHaveLength(
        0,
      );
      expect(await ctx.db.select().from(studentEmailSendLog)).toHaveLength(0);
    });

    it("유예 경계값: active 30일, pending 1일. 유예 중인 유저는 그대로", async () => {
      const activeDue = await withdraw(
        await signupStudent(ctx),
        ago(30 * DAY_MS),
      );
      const activeGrace = await withdraw(
        await signupStudent(ctx),
        ago(30 * DAY_MS - SECOND_MS),
      );
      const pendingDue = await withdraw(
        await login(ctx, "student"),
        ago(DAY_MS),
      );
      const pendingGrace = await withdraw(
        await login(ctx, "student"),
        ago(DAY_MS - SECOND_MS),
      );

      expect(await withdrawal.purgeExpired(now)).toBe(2);

      expect((await findUser(activeDue)).isDeleted).toBe(true);
      expect((await findUser(pendingDue)).isDeleted).toBe(true);
      const kept = await findUser(activeGrace);
      expect(kept.isDeleted).toBe(false);
      expect(kept.name).toBe("김재학");
      expect((await findUser(pendingGrace)).isDeleted).toBe(false);
    });
  });

  describe("만료 데이터 정리", () => {
    it("인증번호 · 발송 기록 · refresh token의 보존 기간 경계값", async () => {
      const purge = await login(ctx, "student");
      const keep = await login(ctx, "student");
      for (const [session, email] of [
        [purge, "expire-purge@gm.gist.ac.kr"],
        [keep, "expire-keep@gm.gist.ac.kr"],
      ] as const) {
        await agreeConsents(ctx, session);
        await sendCode(ctx, session, email);
      }
      const purgePk = await userPkOf(purge);
      const keepPk = await userPkOf(keep);
      const realNow = Date.now();

      await ctx.db
        .update(studentEmailVerification)
        .set({ expiresAt: new Date(now.getTime() - 1) })
        .where(
          eq(studentEmailVerification.email, "expire-purge@gm.gist.ac.kr"),
        );
      await ctx.db
        .update(studentEmailVerification)
        .set({ expiresAt: now })
        .where(eq(studentEmailVerification.email, "expire-keep@gm.gist.ac.kr"));
      await ctx.db
        .update(studentEmailSendLog)
        .set({ createdAt: ago(2 * DAY_MS + 1) })
        .where(eq(studentEmailSendLog.userPk, purgePk));
      await ctx.db
        .update(studentEmailSendLog)
        .set({ createdAt: ago(2 * DAY_MS) })
        .where(eq(studentEmailSendLog.userPk, keepPk));
      // refresh token은 인자 now가 아니라 실제 현재 시각으로 판단함
      await ctx.db
        .update(refreshToken)
        .set({ expiresAt: new Date(realNow - HOUR_MS) })
        .where(eq(refreshToken.userPk, purgePk));
      await ctx.db
        .update(refreshToken)
        .set({ expiresAt: new Date(realNow + HOUR_MS) })
        .where(eq(refreshToken.userPk, keepPk));

      expect(await cleanup.purgeExpiredData(now)).toEqual({
        verifications: 1,
        sendLogs: 1,
        refreshTokens: 1,
      });

      const verifications = await ctx.db
        .select()
        .from(studentEmailVerification);
      expect(verifications.map((v) => v.email)).toEqual([
        "expire-keep@gm.gist.ac.kr",
      ]);
      const logs = await ctx.db.select().from(studentEmailSendLog);
      expect(logs.map((l) => l.userPk)).toEqual([keepPk]);
      const tokens = await ctx.db.select().from(refreshToken);
      expect(tokens.map((t) => t.userPk)).toEqual([keepPk]);
    });
  });
});
