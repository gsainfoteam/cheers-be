import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { adminAccessLog } from "@drizzle/schema/admin-access-log";
import { adminAuditLog } from "@drizzle/schema/admin-audit-log";
import { coffeeChatContact } from "@drizzle/schema/coffee-chat-contact";
import { coffeeChatRequest } from "@drizzle/schema/coffee-chat-request";
import { graduated } from "@drizzle/schema/graduated";
import { graduatedProfile } from "@drizzle/schema/graduated-profile";
import { notificationLog } from "@drizzle/schema/notification-log";
import { refreshToken } from "@drizzle/schema/refresh-token";
import { student } from "@drizzle/schema/student";
import { studentEmailSendLog } from "@drizzle/schema/student-email-send-log";
import { studentProfile } from "@drizzle/schema/student-profile";
import { studentProfileAttachment } from "@drizzle/schema/student-profile-attachment";
import { userConsent } from "@drizzle/schema/user-consent";
import { userOauthAccount } from "@drizzle/schema/user-oauth-account";
import { users } from "@drizzle/schema/users";
import { createE2eApp, E2eContext } from "./support/app";
import {
  bearer,
  getInfo,
  http,
  login,
  loginManager,
  saveStudentInfo,
  Session,
  signupGraduated,
  signupStudent,
  uploadAttachment,
} from "./support/flows";

const BASE = "/api/manager/v1/dev/user";
const SUPER = "super@gm.gist.ac.kr";
const ADMIN = "admin@gm.gist.ac.kr";

describe("개발용 회원 완전탈퇴 (DEV_USER_DELETE_ENABLED=true)", () => {
  let ctx: E2eContext;
  let auth: string;

  // 유저와 그 하위 행이 남아 있는 테이블별 행 수. 지운 뒤 전부 0이어야 함
  const remainingRows = async (userPk: string) => {
    const db = ctx.db;
    const studentPks = (
      await db
        .select({ pk: student.pk })
        .from(student)
        .where(eq(student.userPk, userPk))
    ).map((row) => row.pk);
    const graduatedPks = (
      await db
        .select({ pk: graduated.pk })
        .from(graduated)
        .where(eq(graduated.userPk, userPk))
    ).map((row) => row.pk);
    const byUser = async (
      table:
        | typeof userConsent
        | typeof userOauthAccount
        | typeof refreshToken
        | typeof coffeeChatContact
        | typeof studentEmailSendLog,
    ) => (await db.select().from(table).where(eq(table.userPk, userPk))).length;

    return {
      users: (await db.select().from(users).where(eq(users.pk, userPk))).length,
      student: studentPks.length,
      graduated: graduatedPks.length,
      userConsent: await byUser(userConsent),
      userOauthAccount: await byUser(userOauthAccount),
      refreshToken: await byUser(refreshToken),
      coffeeChatContact: await byUser(coffeeChatContact),
      studentEmailSendLog: await byUser(studentEmailSendLog),
    };
  };

  const NONE = {
    users: 0,
    student: 0,
    graduated: 0,
    userConsent: 0,
    userOauthAccount: 0,
    refreshToken: 0,
    coffeeChatContact: 0,
    studentEmailSendLog: 0,
  };

  const graduatedIdOf = async (studentSession: Session) => {
    const res = await http(ctx)
      .get("/api/v1/cheers")
      .set("Authorization", bearer(studentSession))
      .expect(200);
    return res.body.items[0].graduated_id as string;
  };

  // 커피챗 요청 + 알림 로그 (알림 로그는 메일 발송이 skipped라 직접 넣음)
  const sendRequestWithLog = async (
    studentSession: Session,
    graduatedId: string,
  ): Promise<string> => {
    const res = await http(ctx)
      .post("/api/v1/cheers/request")
      .set("Authorization", bearer(studentSession))
      .send({ graduated_id: graduatedId, message: "질문 있습니다" })
      .expect(201);
    await ctx.db.insert(notificationLog).values({
      pk: randomUUID(),
      coffeeChatRequestPk: res.body.id,
      event: "coffee_chat_requested",
      channel: "email",
      status: "sent",
      recipient: "graduated-contact@example.com",
    });
    return res.body.id;
  };

  const userPkOf = async (session: Session) =>
    (await getInfo(ctx, session)).id as string;

  beforeAll(async () => {
    process.env.DEV_USER_DELETE_ENABLED = "true";
    ctx = await createE2eApp();
  });
  beforeEach(async () => {
    await ctx.reset();
    auth = await loginManager(ctx, SUPER, "superadmin");
  });
  afterAll(async () => {
    await ctx.close();
    process.env.DEV_USER_DELETE_ENABLED = "";
  });

  it("재학생을 지우면 하위 데이터 · 보낸 요청 · 첨부 파일이 사라지고 같은 계정으로 다시 가입할 수 있음", async () => {
    const graduatedSession = await signupGraduated(ctx);
    const studentSession = await signupStudent(ctx);
    const tempKey = await uploadAttachment(ctx, studentSession);
    const linkUrl = "https://example.com/portfolio";
    // 프로필을 두 번 저장해 두 버전이 같은 파일을 참조하게 함
    const attachments = [
      { kind: "cv", source: "file", key: tempKey, file_name: "cv.pdf" },
      { kind: "portfolio", source: "link", url: linkUrl },
    ];
    await saveStudentInfo(ctx, studentSession, { attachments });
    const info = await getInfo(ctx, studentSession);
    const fileKey = info.student.profile.attachments.find(
      (a: { source: string }) => a.source === "file",
    ).key as string;
    await saveStudentInfo(ctx, studentSession, {
      attachments: [
        { kind: "cv", source: "file", key: fileKey, file_name: "cv.pdf" },
      ],
    });
    const requestPk = await sendRequestWithLog(
      studentSession,
      await graduatedIdOf(studentSession),
    );
    const studentUserPk = info.id as string;
    const [{ pk: studentPk }] = await ctx.db
      .select({ pk: student.pk })
      .from(student)
      .where(eq(student.userPk, studentUserPk));
    ctx.s3.clearDeleteLog();

    await http(ctx)
      .delete(`${BASE}/${studentUserPk}`)
      .set("Authorization", auth)
      .expect(200, { result: "OK" });

    expect(await remainingRows(studentUserPk)).toEqual(NONE);
    expect(
      await ctx.db
        .select()
        .from(studentProfile)
        .where(eq(studentProfile.studentPk, studentPk)),
    ).toHaveLength(0);
    expect(await ctx.db.select().from(studentProfileAttachment)).toHaveLength(
      0,
    );
    expect(
      await ctx.db
        .select()
        .from(coffeeChatRequest)
        .where(eq(coffeeChatRequest.pk, requestPk)),
    ).toHaveLength(0);
    expect(await ctx.db.select().from(notificationLog)).toHaveLength(0);
    // 파일 첨부만 한 번 지우고, 링크는 외부 주소라 건드리지 않음
    expect(ctx.s3.deletedKeys).toEqual([fileKey]);
    expect(ctx.s3.objects.has(fileKey)).toBe(false);

    // 상대 현업자는 그대로
    const graduatedUserPk = await userPkOf(graduatedSession);
    expect(await remainingRows(graduatedUserPk)).toMatchObject({
      users: 1,
      graduated: 1,
    });

    const logs = await ctx.db.select().from(adminAccessLog);
    expect(logs).toEqual([
      expect.objectContaining({
        adminEmail: SUPER,
        targetType: "dev_user_hard_delete",
        targetId: studentUserPk,
      }),
    ]);
    // 감사 로그(CRB-81): 지우기 전의 유저 행이 before로 남음
    expect(
      await ctx.db
        .select()
        .from(adminAuditLog)
        .where(eq(adminAuditLog.action, "dev_user.hard_delete")),
    ).toEqual([
      expect.objectContaining({
        adminEmail: SUPER,
        action: "dev_user.hard_delete",
        targetType: "user",
        targetId: studentUserPk,
        before: expect.objectContaining({
          type: "student",
          student_pks: [expect.any(String)],
        }),
        after: null,
      }),
    ]);

    // 지운 유저의 access token은 더 쓸 수 없고, 같은 Google 계정으로 처음부터 다시 가입
    await http(ctx)
      .get("/api/v1/user/info")
      .set("Authorization", bearer(studentSession))
      .expect(401);
    const again = await login(ctx, "student", studentSession.sub);
    const againInfo = await getInfo(ctx, again);
    expect(againInfo.id).not.toBe(studentUserPk);
    expect(againInfo.next_step).toBe("consent");
  });

  it("현업자를 지우면 명함 파일 · 프로필 · 받은 요청이 사라지고 보낸 재학생은 남음", async () => {
    const graduatedSession = await signupGraduated(ctx);
    const studentSession = await signupStudent(ctx);
    await sendRequestWithLog(
      studentSession,
      await graduatedIdOf(studentSession),
    );
    const graduatedUserPk = await userPkOf(graduatedSession);
    const [{ pk: graduatedPk, businessCardKey }] = await ctx.db
      .select()
      .from(graduated)
      .where(eq(graduated.userPk, graduatedUserPk));
    ctx.s3.clearDeleteLog();

    await http(ctx)
      .delete(`${BASE}/${graduatedUserPk}`)
      .set("Authorization", auth)
      .expect(200);

    expect(await remainingRows(graduatedUserPk)).toEqual(NONE);
    expect(
      await ctx.db
        .select()
        .from(graduatedProfile)
        .where(eq(graduatedProfile.graduatedPk, graduatedPk)),
    ).toHaveLength(0);
    expect(await ctx.db.select().from(coffeeChatRequest)).toHaveLength(0);
    expect(await ctx.db.select().from(notificationLog)).toHaveLength(0);
    expect(ctx.s3.deletedKeys).toEqual([businessCardKey]);

    const studentUserPk = await userPkOf(studentSession);
    expect(await remainingRows(studentUserPk)).toMatchObject({
      users: 1,
      student: 1,
    });
  });

  it("유형을 바꾼 유저(student · graduated 행이 둘 다 있음)와 탈퇴 처리가 끝난 유저도 지움", async () => {
    const session = await signupStudent(ctx);
    const userPk = await userPkOf(session);
    // 가입 중에 유형을 바꾸면 이전 유형의 행이 남음. 그 상태를 직접 만듦
    await ctx.db.insert(graduated).values({ pk: randomUUID(), userPk });
    expect(await remainingRows(userPk)).toMatchObject({
      student: 1,
      graduated: 1,
    });
    await ctx.db
      .update(users)
      .set({ isDeleted: true, withdrawRequestedAt: new Date() })
      .where(eq(users.pk, userPk));

    await http(ctx)
      .delete(`${BASE}/${userPk}`)
      .set("Authorization", auth)
      .expect(200);

    expect(await remainingRows(userPk)).toEqual(NONE);
  });

  it("목록은 최근 가입 순이고 고르는 데 필요한 값만 내려줌", async () => {
    const first = await signupStudent(ctx);
    const second = await signupGraduated(ctx);
    const firstPk = await userPkOf(first);
    const secondPk = await userPkOf(second);
    // 같은 시각이 나오지 않게 가입 시각을 벌려 둠
    await ctx.db
      .update(users)
      .set({ createdAt: new Date("2026-01-01T00:00:00Z") })
      .where(eq(users.pk, firstPk));
    await ctx.db
      .update(users)
      .set({ withdrawRequestedAt: new Date() })
      .where(eq(users.pk, secondPk));

    const res = await http(ctx)
      .get(BASE)
      .query({ page: 1, size: 1 })
      .set("Authorization", auth)
      .expect(200);

    expect(res.body).toEqual({
      items: [
        {
          user_pk: secondPk,
          type: "graduated",
          status: "withdrawal_requested",
          name: "박현업",
          email: `${second.sub}@gmail.com`,
          created_at: expect.any(String),
        },
      ],
      page: 1,
      size: 1,
      total: 2,
    });

    const next = await http(ctx)
      .get(BASE)
      .query({ page: 2, size: 1 })
      .set("Authorization", auth)
      .expect(200);
    expect(next.body.items).toEqual([
      expect.objectContaining({
        user_pk: firstPk,
        type: "student",
        status: "active",
      }),
    ]);

    await http(ctx)
      .get(BASE)
      .query({ size: 51 })
      .set("Authorization", auth)
      .expect(400);
  });

  it("superadmin만 쓸 수 있고, 없는 유저는 404 · 잘못된 pk는 400", async () => {
    const session = await signupStudent(ctx);
    const userPk = await userPkOf(session);
    const adminAuth = await loginManager(ctx, ADMIN, "admin");

    await http(ctx).get(BASE).expect(401);
    await http(ctx).delete(`${BASE}/${userPk}`).expect(401);
    await http(ctx).get(BASE).set("Authorization", adminAuth).expect(403);
    await http(ctx)
      .delete(`${BASE}/${userPk}`)
      .set("Authorization", adminAuth)
      .expect(403);
    expect(await remainingRows(userPk)).toMatchObject({ users: 1 });

    await http(ctx)
      .delete(`${BASE}/${randomUUID()}`)
      .set("Authorization", auth)
      .expect(404, { statusCode: 404, message: "User not found" });
    await http(ctx)
      .delete(`${BASE}/not-a-uuid`)
      .set("Authorization", auth)
      .expect(400);
    expect(await ctx.db.select().from(adminAccessLog)).toHaveLength(0);
    expect(
      await ctx.db
        .select()
        .from(adminAuditLog)
        .where(eq(adminAuditLog.action, "dev_user.hard_delete")),
    ).toHaveLength(0);
  });
});

describe("개발용 회원 완전탈퇴 (DEV_USER_DELETE_ENABLED 꺼짐, 기본값)", () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    process.env.DEV_USER_DELETE_ENABLED = "";
    ctx = await createE2eApp();
  });
  beforeEach(() => ctx.reset());
  afterAll(() => ctx.close());

  it("토큰 · 권한과 상관없이 목록 · 삭제 모두 없는 경로와 같은 404이고 아무것도 지우지 않음", async () => {
    const auth = await loginManager(ctx, SUPER, "superadmin");
    const session = await signupStudent(ctx);
    const userPk = await userPkOf(session);

    const unknownRoute = await http(ctx)
      .get("/api/manager/v1/dev/no-such-route")
      .expect(404);
    expect(unknownRoute.body).toEqual({
      statusCode: 404,
      message: "Cannot GET /api/manager/v1/dev/no-such-route",
    });

    const routes = [
      { method: "GET", path: `${BASE}?page=1` },
      { method: "DELETE", path: `${BASE}/${userPk}` },
    ] as const;
    for (const { method, path } of routes) {
      for (const authorization of [null, auth]) {
        const req =
          method === "GET" ? http(ctx).get(path) : http(ctx).delete(path);
        if (authorization) req.set("Authorization", authorization);
        const res = await req.expect(404);
        expect(res.body).toEqual({
          statusCode: 404,
          message: `Cannot ${method} ${path}`,
        });
      }
    }

    expect(
      await ctx.db.select().from(users).where(eq(users.pk, userPk)),
    ).toHaveLength(1);
  });

  async function userPkOf(session: Session) {
    return (await getInfo(ctx, session)).id as string;
  }
});
