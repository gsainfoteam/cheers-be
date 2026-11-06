import { randomUUID } from "node:crypto";
import { count, eq, like } from "drizzle-orm";
import { seedDevData, uploadDevBusinessCards } from "@drizzle/seed-dev-data";
import { adminAccessLog } from "@drizzle/schema/admin-access-log";
import { coffeeChatContact } from "@drizzle/schema/coffee-chat-contact";
import { coffeeChatRequest } from "@drizzle/schema/coffee-chat-request";
import { graduated } from "@drizzle/schema/graduated";
import { notificationLog } from "@drizzle/schema/notification-log";
import { refreshToken } from "@drizzle/schema/refresh-token";
import { student } from "@drizzle/schema/student";
import { studentEmailSendLog } from "@drizzle/schema/student-email-send-log";
import { studentProfile } from "@drizzle/schema/student-profile";
import { studentProfileAttachment } from "@drizzle/schema/student-profile-attachment";
import { userConsent } from "@drizzle/schema/user-consent";
import { users } from "@drizzle/schema/users";
import { AuthService } from "@src/auth/auth.service";
import { calculateNextStep } from "@src/auth/signup-step";
import { UserRepository } from "@src/database/repository/user.repository";
import { createE2eApp, E2eContext } from "./support/app";
import {
  bearer,
  getInfo,
  http,
  loginManager,
  signupStudent,
} from "./support/flows";

const REQUESTS = "/api/manager/v1/coffee-chat/request";
const LOGS = "/api/manager/v1/coffee-chat/notification-log";
const CARDS = "/api/manager/v1/business-card";
const DEV_ROWS = [
  users,
  student,
  studentProfile,
  studentProfileAttachment,
  graduated,
  coffeeChatContact,
  coffeeChatRequest,
  notificationLog,
  userConsent,
  studentEmailSendLog,
];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("개발용 seed (가짜 S3)", () => {
  let ctx: E2eContext;
  let auth: string;

  const seed = () => seedDevData(ctx.db);

  const rowCounts = async () =>
    Promise.all(
      DEV_ROWS.map(async (table) => {
        const [{ total }] = await ctx.db.select({ total: count() }).from(table);
        return total;
      }),
    );

  const devUser = async (email: string) => {
    const [user] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.email, email));
    return user;
  };

  // seed된 유저로 API를 부르는 토큰. 앱에는 발급 경로가 없어 서비스를 직접 호출
  const issueToken = (user: typeof users.$inferSelect) =>
    ctx.db.transaction((tx) => ctx.app.get(AuthService).issueTokens(user, tx));

  beforeAll(async () => {
    ctx = await createE2eApp();
  });

  beforeEach(async () => {
    await ctx.reset();
    auth = await loginManager(ctx, "admin@gm.gist.ac.kr", "admin");
  });

  afterAll(async () => {
    await ctx.reset();
    await ctx.close();
  });

  it("다시 실행해도 행 수가 같고 실패하지 않음", async () => {
    await seed();
    const first = await rowCounts();

    await seed();

    expect(await rowCounts()).toEqual(first);
    expect(first.every((total) => total > 0)).toBe(true);
  });

  it("실제 유저는 남기고, API로 생긴 개발용 데이터는 지움", async () => {
    const realSession = await signupStudent(ctx);
    const realUserPk = (await getInfo(ctx, realSession)).id;

    await seed();
    const devStudent = await devUser("dev-student-01@dev.cheers.local");
    const tokens = await issueToken(devStudent);
    expect(tokens.refreshToken).toBeTruthy();

    // 실제 재학생이 개발용 현업자에게 보낸 요청 (FK 때문에 같이 지워져야 함)
    const list = await http(ctx)
      .get("/api/v1/cheers")
      .query({ size: 50 })
      .set("Authorization", bearer(realSession))
      .expect(200);
    const target = list.body.items.find(
      (item: { can_request: boolean }) => item.can_request,
    );
    const created = await http(ctx)
      .post("/api/v1/cheers/request")
      .set("Authorization", bearer(realSession))
      .send({ graduated_id: target.graduated_id, message: "e2e" })
      .expect(201);
    await ctx.db.insert(adminAccessLog).values({
      pk: randomUUID(),
      adminEmail: "admin@gm.gist.ac.kr",
      targetType: "business_card",
      targetId: target.graduated_id,
    });

    await seed();

    const remaining = await ctx.db
      .select({ pk: users.pk })
      .from(users)
      .where(eq(users.pk, realUserPk));
    expect(remaining).toHaveLength(1);
    expect(
      await ctx.db
        .select()
        .from(coffeeChatRequest)
        .where(eq(coffeeChatRequest.pk, created.body.id)),
    ).toHaveLength(0);
    expect(
      await ctx.db
        .select()
        .from(adminAccessLog)
        .where(eq(adminAccessLog.targetId, target.graduated_id)),
    ).toHaveLength(0);
    // 다시 넣은 개발용 유저의 refresh token은 사라짐
    expect(
      await ctx.db
        .select()
        .from(refreshToken)
        .where(eq(refreshToken.userPk, devStudent.pk)),
    ).toHaveLength(0);
  });

  it("어드민 목록과 필터에 상태별로 나옴", async () => {
    await seed();

    for (const status of ["requested", "viewed", "contact_shared"]) {
      const res = await http(ctx)
        .get(REQUESTS)
        .query({ status })
        .set("Authorization", auth)
        .expect(200);
      expect(res.body.total).toBeGreaterThan(0);
    }
    const all = await http(ctx)
      .get(REQUESTS)
      .query({ size: 50 })
      .set("Authorization", auth)
      .expect(200);
    expect(all.body.total).toBeGreaterThan(20);
    expect(
      all.body.items.some(
        (item: { student: { active: boolean } }) => !item.student.active,
      ),
    ).toBe(true);
    expect(
      all.body.items.some(
        (item: { graduated: { active: boolean } }) => !item.graduated.active,
      ),
    ).toBe(true);

    for (const status of ["sent", "failed"]) {
      const res = await http(ctx)
        .get(LOGS)
        .query({ status })
        .set("Authorization", auth)
        .expect(200);
      expect(res.body.total).toBeGreaterThan(0);
    }

    const cards = await http(ctx)
      .get(CARDS)
      .query({ size: 50 })
      .set("Authorization", auth)
      .expect(200);
    expect(cards.body.total).toBeGreaterThan(20);
    const states = new Set(
      cards.body.items.map(
        (item: { has_business_card: boolean }) => item.has_business_card,
      ),
    );
    expect(states).toEqual(new Set([true, false]));
  });

  it("가입 단계가 시나리오대로 계산됨", async () => {
    await seed();
    const repository = ctx.app.get(UserRepository);
    const expected: [string, ReturnType<typeof calculateNextStep>][] = [
      ["dev-student-01", null],
      ["dev-graduated-01", null],
      ["dev-graduated-cancelled-01", "verify"],
      ["dev-pending-student-consent", "consent"],
      ["dev-pending-student-verify", "verify"],
      ["dev-pending-student-profile", "profile"],
      ["dev-pending-graduated-consent", "consent"],
      ["dev-pending-graduated-verify", "verify"],
      ["dev-pending-graduated-profile", "profile"],
    ];

    for (const [label, nextStep] of expected) {
      const user = await devUser(`${label}@dev.cheers.local`);
      const progress = await repository.findSignupProgress(user.pk, user.type);
      expect([label, calculateNextStep(user.status, progress)]).toEqual([
        label,
        nextStep,
      ]);
    }
  });

  it("seed된 재학생으로 학교 도메인 기준 학과를 조회함", async () => {
    await seed();
    const { accessToken } = await issueToken(
      await devUser("dev-student-01@dev.cheers.local"),
    );

    const res = await http(ctx)
      .get("/api/v1/user/student/departments")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.departments.length).toBeGreaterThan(0);
  });

  it("명함 이미지를 올리고 어드민 URL이 같은 key를 가리킴", async () => {
    const { businessCardKeys } = await seed();

    const result = await uploadDevBusinessCards(businessCardKeys);

    expect(result).toEqual({ uploaded: businessCardKeys.length, error: null });
    for (const key of businessCardKeys) {
      expect(key.startsWith("dev-seed/business-card/")).toBe(true);
      const body = ctx.s3.objects.get(key)?.body;
      expect(body?.subarray(0, 4).equals(PNG_SIGNATURE)).toBe(true);
    }

    const [card] = await ctx.db
      .select({ pk: graduated.pk, key: graduated.businessCardKey })
      .from(graduated)
      .where(like(graduated.businessCardKey, "dev-seed/%"))
      .limit(1);
    const res = await http(ctx)
      .get(`${CARDS}/${card.pk}`)
      .set("Authorization", auth)
      .expect(200);
    expect(res.body.url).toContain(card.key);
  });

  it("업로드에 실패해도 예외 없이 결과로 돌려주고 DB 데이터는 남음", async () => {
    const { businessCardKeys } = await seed();
    const bucket = process.env.AWS_S3_BUCKET_NAME;
    process.env.AWS_S3_BUCKET_NAME = "";

    const result = await uploadDevBusinessCards(businessCardKeys);

    process.env.AWS_S3_BUCKET_NAME = bucket;
    expect(result.uploaded).toBe(0);
    expect(result.error).toContain("AWS_S3_BUCKET_NAME");
    const [{ total }] = await ctx.db
      .select({ total: count() })
      .from(users)
      .where(like(users.email, "%@dev.cheers.local"));
    expect(total).toBeGreaterThan(0);
  });

  it("개발용 유저 pk는 고정 범위 안에 있음", async () => {
    await seed();
    const devUsers = await ctx.db.select({ pk: users.pk }).from(users);

    expect(devUsers.length).toBeGreaterThan(0);
    for (const { pk } of devUsers) {
      expect(pk.startsWith("de000000-0000-4000-8000-")).toBe(true);
    }
  });
});
