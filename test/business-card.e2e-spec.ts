import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { adminAccessLog } from "@drizzle/schema/admin-access-log";
import { adminAccount } from "@drizzle/schema/admin-account";
import { graduated } from "@drizzle/schema/graduated";
import { users } from "@drizzle/schema/users";
import { AdminAccessLogRepository } from "@src/admin-repository/admin-access-log.repository";
import { OrphanFileService } from "@src/file/orphan-file.service";
import { WithdrawalService } from "@src/user/withdrawal.service";
import { CleanupService } from "@src/user/cleanup.service";
import { createE2eApp, E2eContext } from "./support/app";
import {
  agreeConsents,
  bearer,
  getInfo,
  http,
  login,
  Session,
  signupGraduated,
  signupStudent,
  submitBusinessCard,
} from "./support/flows";

const BASE = "/api/manager/v1/business-card";
const SUPER = "super@gm.gist.ac.kr";
const ADMIN = "admin@gm.gist.ac.kr";
const DAY_MS = 24 * 60 * 60 * 1000;

describe("어드민 현업자 명함 (가짜 S3)", () => {
  let ctx: E2eContext;

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

  const graduatedRowOf = async (session: Session) => {
    const { id } = await getInfo(ctx, session);
    const [row] = await ctx.db
      .select()
      .from(graduated)
      .where(eq(graduated.userPk, id));
    return row;
  };

  const cancel = (auth: string, pk: string) =>
    http(ctx)
      .post(`${BASE}/${pk}/cancel-verification`)
      .set("Authorization", auth);

  const visibleIds = async (student: Session): Promise<string[]> => {
    const res = await http(ctx)
      .get("/api/v1/cheers")
      .set("Authorization", bearer(student))
      .expect(200);
    return res.body.items.map(
      (item: { graduated_id: string }) => item.graduated_id,
    );
  };

  beforeAll(async () => {
    process.env.S3_ORPHAN_DELETE_ENABLED = "true";
    ctx = await createE2eApp();
  });
  beforeEach(() => ctx.reset());
  afterAll(async () => {
    await ctx.close();
    process.env.S3_ORPHAN_DELETE_ENABLED = "";
  });

  describe("권한", () => {
    it("토큰이 없으면 401, 앱 사용자 토큰도 401", async () => {
      const session = await signupGraduated(ctx);
      const { pk } = await graduatedRowOf(session);

      await http(ctx).get(BASE).expect(401);
      await http(ctx).get(`${BASE}/${pk}`).expect(401);
      await http(ctx).post(`${BASE}/${pk}/cancel-verification`).expect(401);
      await http(ctx)
        .get(`${BASE}/${pk}`)
        .set("Authorization", bearer(session))
        .expect(401);
    });

    it("admin은 목록 · 명함 조회만, 인증 취소는 403이고 상태가 그대로", async () => {
      const auth = await managerAuth(ADMIN, "admin");
      const session = await signupGraduated(ctx);
      const { pk, businessCardKey } = await graduatedRowOf(session);

      await http(ctx).get(BASE).set("Authorization", auth).expect(200);
      await http(ctx)
        .get(`${BASE}/${pk}`)
        .set("Authorization", auth)
        .expect(200);
      await cancel(auth, pk).expect(403);

      const row = await graduatedRowOf(session);
      expect(row.businessCardKey).toBe(businessCardKey);
      expect(row.verifiedAt).not.toBeNull();
    });
  });

  describe("목록", () => {
    it("업로드 여부 · 인증 시각 · 가입 상태. key 원문은 내려주지 않음", async () => {
      const auth = await managerAuth(ADMIN, "admin");
      const active = await signupGraduated(ctx, { nickname: "가입완료" });
      const activeRow = await graduatedRowOf(active);
      const pending = await login(ctx, "graduated");
      await agreeConsents(ctx, pending);
      const pendingRow = await graduatedRowOf(pending);

      const res = await http(ctx)
        .get(BASE)
        .set("Authorization", auth)
        .expect(200);

      expect(res.body).toMatchObject({ page: 1, size: 20, total: 2 });
      // 인증 시각 내림차순, 미인증은 뒤로
      expect(res.body.items).toEqual([
        {
          graduated_pk: activeRow.pk,
          name: "박현업",
          nickname: "가입완료",
          company: "인포테크",
          job: "백엔드 개발자",
          has_business_card: true,
          verified_at: activeRow.verifiedAt?.toISOString(),
          signup_status: "active",
        },
        {
          graduated_pk: pendingRow.pk,
          name: null,
          nickname: null,
          company: null,
          job: null,
          has_business_card: false,
          verified_at: null,
          signup_status: "pending",
        },
      ]);
      expect(JSON.stringify(res.body)).not.toContain(
        activeRow.businessCardKey as string,
      );
    });

    it("탈퇴 유예기간은 표시하고 탈퇴 처리가 끝나면 뺌", async () => {
      const auth = await managerAuth(ADMIN, "admin");
      const session = await signupGraduated(ctx);
      const { id } = await getInfo(ctx, session);
      await http(ctx)
        .post("/api/v1/user/withdraw")
        .set("Authorization", bearer(session))
        .send({})
        .expect(201);

      const during = await http(ctx)
        .get(BASE)
        .set("Authorization", auth)
        .expect(200);
      expect(during.body.items[0].signup_status).toBe("withdrawal_requested");

      await ctx.db
        .update(users)
        .set({ isDeleted: true })
        .where(eq(users.pk, id));
      const after = await http(ctx)
        .get(BASE)
        .set("Authorization", auth)
        .expect(200);
      expect(after.body).toMatchObject({ items: [], total: 0 });
    });

    it("query 형식 오류는 400", async () => {
      const auth = await managerAuth(ADMIN, "admin");
      await http(ctx)
        .get(`${BASE}?size=51`)
        .set("Authorization", auth)
        .expect(400);
    });
  });

  describe("명함 조회와 열람 기록", () => {
    it("URL을 발급하고 어드민 이메일 · 대상 · 시각을 남김", async () => {
      const auth = await managerAuth(ADMIN, "admin");
      const session = await signupGraduated(ctx);
      const { pk, businessCardKey } = await graduatedRowOf(session);

      const res = await http(ctx)
        .get(`${BASE}/${pk}`)
        .set("Authorization", auth)
        .expect(200);

      expect(res.body).toEqual({
        url: expect.stringContaining(businessCardKey as string),
        expires_in: 60,
      });
      expect(res.body.url).toContain("X-Amz-Expires=60");
      expect(await ctx.db.select().from(adminAccessLog)).toEqual([
        {
          pk: expect.any(String),
          adminEmail: ADMIN,
          targetType: "business_card",
          targetId: pk,
          createdAt: expect.any(Date),
        },
      ]);
    });

    it("조회할 때마다 기록이 쌓임", async () => {
      const auth = await managerAuth(ADMIN, "admin");
      const { pk } = await graduatedRowOf(await signupGraduated(ctx));

      await http(ctx)
        .get(`${BASE}/${pk}`)
        .set("Authorization", auth)
        .expect(200);
      await http(ctx)
        .get(`${BASE}/${pk}`)
        .set("Authorization", auth)
        .expect(200);

      expect(await ctx.db.select().from(adminAccessLog)).toHaveLength(2);
    });

    it("기록 저장에 실패하면 500이고 URL을 발급하지 않음", async () => {
      const auth = await managerAuth(ADMIN, "admin");
      const { pk } = await graduatedRowOf(await signupGraduated(ctx));
      jest
        .spyOn(ctx.app.get(AdminAccessLogRepository), "insert")
        .mockRejectedValueOnce(new Error("db down"));

      const res = await http(ctx)
        .get(`${BASE}/${pk}`)
        .set("Authorization", auth)
        .expect(500);

      expect(res.body.url).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain("X-Amz");
      expect(await ctx.db.select().from(adminAccessLog)).toEqual([]);
    });

    it("없는 현업자 · 명함 없음은 404, 기록 없음. UUID가 아니면 400", async () => {
      const auth = await managerAuth(ADMIN, "admin");
      const pending = await login(ctx, "graduated");
      const { pk } = await graduatedRowOf(pending);

      const notFound = await http(ctx)
        .get(`${BASE}/${randomUUID()}`)
        .set("Authorization", auth)
        .expect(404);
      expect(notFound.body.message).toBe("Graduated not found");
      const noCard = await http(ctx)
        .get(`${BASE}/${pk}`)
        .set("Authorization", auth)
        .expect(404);
      expect(noCard.body.message).toBe("Business card not found");
      await http(ctx)
        .get(`${BASE}/not-a-uuid`)
        .set("Authorization", auth)
        .expect(400);

      expect(await ctx.db.select().from(adminAccessLog)).toEqual([]);
    });

    it("열람 기록이 있어도 탈퇴 만료 처리와 미완료 가입 정리가 실패하지 않음", async () => {
      const auth = await managerAuth(ADMIN, "admin");
      const active = await signupGraduated(ctx);
      const activeInfo = await getInfo(ctx, active);
      const activeRow = await graduatedRowOf(active);
      const pending = await login(ctx, "graduated");
      await agreeConsents(ctx, pending);
      await submitBusinessCard(ctx, pending);
      const pendingInfo = await getInfo(ctx, pending);
      const pendingRow = await graduatedRowOf(pending);
      for (const { pk } of [activeRow, pendingRow]) {
        await http(ctx)
          .get(`${BASE}/${pk}`)
          .set("Authorization", auth)
          .expect(200);
      }
      const now = new Date();
      const longAgo = new Date(now.getTime() - 60 * DAY_MS);
      await ctx.db
        .update(users)
        .set({ withdrawRequestedAt: longAgo })
        .where(eq(users.pk, activeInfo.id));
      await ctx.db
        .update(users)
        .set({ createdAt: longAgo, lastActiveAt: longAgo })
        .where(eq(users.pk, pendingInfo.id));

      expect(await ctx.app.get(WithdrawalService).purgeExpired(now)).toBe(1);
      expect(
        await ctx.app.get(CleanupService).purgeIncompleteSignups(now),
      ).toBe(1);

      expect(await ctx.db.select().from(adminAccessLog)).toHaveLength(2);
      const rows = await ctx.db.select().from(users);
      expect(rows.map((u) => u.pk)).toEqual([activeInfo.id]);
      expect(rows[0].isDeleted).toBe(true);
    });
  });

  describe("인증 취소", () => {
    it("취소 → 목록 · 새 요청에서 빠짐 → 받은 요청 403 → 재업로드하면 전부 복구, 이전 요청도 그대로", async () => {
      const auth = await managerAuth(SUPER, "superadmin");
      const session = await signupGraduated(ctx);
      const student = await signupStudent(ctx);
      const { pk, businessCardKey: oldKey } = await graduatedRowOf(session);
      const created = await http(ctx)
        .post("/api/v1/cheers/request")
        .set("Authorization", bearer(student))
        .send({ graduated_id: pk, message: "질문 있습니다" })
        .expect(201);
      const requestId = created.body.id;
      ctx.s3.clearDeleteLog();

      const canceled = await cancel(auth, pk).expect(200);
      expect(canceled.body).toEqual({ result: "OK" });

      // DB: 인증 전 상태. 요청 안에서 S3 파일은 지우지 않음
      const row = await graduatedRowOf(session);
      expect(row.verifiedAt).toBeNull();
      expect(row.businessCardKey).toBeNull();
      expect(ctx.s3.deletedKeys).toEqual([]);
      expect(ctx.s3.objects.has(oldKey as string)).toBe(true);

      // 가입 단계: 계정은 active로 남고 다음 단계가 verify
      expect(await getInfo(ctx, session)).toMatchObject({
        status: "active",
        next_step: "verify",
        graduated: { verified: false, profile: { company: "인포테크" } },
      });

      // 재학생 쪽: 목록에서 빠지고 새 요청은 404. 이미 보낸 요청은 남음
      expect(await visibleIds(student)).toEqual([]);
      await http(ctx)
        .post("/api/v1/cheers/request")
        .set("Authorization", bearer(student))
        .send({ graduated_id: pk, message: "또 질문" })
        .expect(404);
      await http(ctx)
        .get(`/api/v1/cheers/sent/${requestId}`)
        .set("Authorization", bearer(student))
        .expect(200);

      // 현업자 쪽: 기존 access token(active)으로도 받은 요청 처리 불가
      for (const call of [
        () => http(ctx).get("/api/v1/cheers/received"),
        () => http(ctx).get(`/api/v1/cheers/received/${requestId}`),
        () =>
          http(ctx).post(`/api/v1/cheers/received/${requestId}/share-contact`),
      ]) {
        const res = await call()
          .set("Authorization", bearer(session))
          .expect(403);
        expect(res.body.message).toBe("Business card verification is required");
      }

      // 명함 조회 404, 다시 취소하면 409
      await http(ctx)
        .get(`${BASE}/${pk}`)
        .set("Authorization", auth)
        .expect(404);
      await cancel(auth, pk).expect(409);

      // 재업로드: 추가 정보 없이 바로 복구
      await submitBusinessCard(ctx, session);
      const reverified = await graduatedRowOf(session);
      expect(reverified.verifiedAt).not.toBeNull();
      expect(reverified.businessCardKey).not.toBe(oldKey);
      expect(await getInfo(ctx, session)).toMatchObject({
        status: "active",
        next_step: null,
        graduated: { verified: true },
      });
      expect(await visibleIds(student)).toEqual([pk]);
      await http(ctx)
        .post(`/api/v1/cheers/received/${requestId}/share-contact`)
        .set("Authorization", bearer(session))
        .expect(200);
    });

    it("access token을 다시 받아도 active. 토큰 갱신 · 로그인이 막히지 않음", async () => {
      const auth = await managerAuth(SUPER, "superadmin");
      const session = await signupGraduated(ctx);
      const { pk } = await graduatedRowOf(session);
      await cancel(auth, pk).expect(200);

      const refreshed = await http(ctx)
        .post("/api/v1/user/refresh")
        .send({ refresh_token: session.refreshToken })
        .expect(201);
      const next = { ...session, accessToken: refreshed.body.access_token };
      expect(await getInfo(ctx, next)).toMatchObject({
        status: "active",
        next_step: "verify",
      });

      // 다른 유형으로 로그인해도 active라 유형이 바뀌지 않고, 받은 요청이 있어도 지우지 않음
      const again = await login(ctx, "student", session.sub);
      expect(await getInfo(ctx, again)).toMatchObject({
        type: "graduated",
        next_step: "verify",
      });
    });

    it("가입 중인 현업자를 취소하면 다시 verify 단계", async () => {
      const auth = await managerAuth(SUPER, "superadmin");
      const session = await login(ctx, "graduated");
      await agreeConsents(ctx, session);
      await submitBusinessCard(ctx, session);
      const { pk } = await graduatedRowOf(session);
      expect((await getInfo(ctx, session)).next_step).toBe("profile");

      await cancel(auth, pk).expect(200);

      expect(await getInfo(ctx, session)).toMatchObject({
        status: "pending",
        next_step: "verify",
      });
      await submitBusinessCard(ctx, session);
      expect((await getInfo(ctx, session)).next_step).toBe("profile");
    });

    it("미인증 현업자는 409, 없는 현업자는 404", async () => {
      const auth = await managerAuth(SUPER, "superadmin");
      const { pk } = await graduatedRowOf(await login(ctx, "graduated"));

      await cancel(auth, pk).expect(409);
      await cancel(auth, randomUUID()).expect(404);
      await cancel(auth, "not-a-uuid").expect(400);
    });

    it("취소된 명함 파일은 고아 파일 정리가 지우고 재업로드한 파일은 남김", async () => {
      const auth = await managerAuth(SUPER, "superadmin");
      const session = await signupGraduated(ctx);
      const { pk, businessCardKey: oldKey } = await graduatedRowOf(session);
      await cancel(auth, pk).expect(200);
      await submitBusinessCard(ctx, session);
      const { businessCardKey: newKey } = await graduatedRowOf(session);

      const now = new Date();
      const old = new Date(now.getTime() - 2 * DAY_MS);
      ctx.s3.setLastModified(oldKey as string, old);
      ctx.s3.setLastModified(newKey as string, old);
      ctx.s3.clearDeleteLog();

      const result = await ctx.app.get(OrphanFileService).cleanup(now);

      expect(result).toMatchObject({ orphans: 1, deleted: 1, stopped: false });
      expect(ctx.s3.deletedKeys).toEqual([oldKey]);
      expect(ctx.s3.objects.has(newKey as string)).toBe(true);
    });
  });
});
