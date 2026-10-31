import { randomUUID } from "node:crypto";
import { CronExpression, SchedulerRegistry } from "@nestjs/schedule";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { desc, eq } from "drizzle-orm";
import { adminAccount } from "@drizzle/schema/admin-account";
import { interest } from "@drizzle/schema/interest";
import { studentProfile } from "@drizzle/schema/student-profile";
import { InterestService } from "@src/student/interest.service";
import { createE2eApp, E2eContext } from "./support/app";
import {
  bearer,
  http,
  saveStudentInfo,
  Session,
  signupStudent,
} from "./support/flows";

const BASE = "/api/manager/v1/interest";
const APP_LIST = "/api/v1/user/student/interests";
const ADMIN = "admin@gm.gist.ac.kr";

describe("manager interest", () => {
  let ctx: E2eContext;
  let seed: (typeof interest.$inferSelect)[];
  let auth: string;

  const appList = async (session: Session): Promise<string[]> => {
    const res = await http(ctx)
      .get(APP_LIST)
      .set("Authorization", bearer(session))
      .expect(200);
    return res.body.interests;
  };

  const adminList = async (): Promise<{ pk: number; name: string }[]> => {
    const res = await http(ctx)
      .get(BASE)
      .set("Authorization", auth)
      .expect(200);
    return res.body;
  };

  const post = (name: unknown) =>
    http(ctx).post(BASE).set("Authorization", auth).send({ name });
  const patch = (pk: number | string, name: unknown) =>
    http(ctx).patch(`${BASE}/${pk}`).set("Authorization", auth).send({ name });
  const remove = (pk: number | string) =>
    http(ctx).delete(`${BASE}/${pk}`).set("Authorization", auth);
  const reorder = (pks: unknown) =>
    http(ctx).put(`${BASE}/order`).set("Authorization", auth).send({ pks });

  // interest는 reset으로 비워지지 않는 기준 데이터라 다른 테스트에 영향이 없도록 되돌림
  const restoreSeed = async () => {
    await ctx.db.delete(interest);
    await ctx.db.insert(interest).values(seed);
    await ctx.app.get(InterestService).refresh();
  };

  beforeAll(async () => {
    ctx = await createE2eApp();
    seed = await ctx.db.select().from(interest).orderBy(interest.sortOrder);
  });
  beforeEach(async () => {
    await ctx.reset();
    // superadmin이 아닌 admin으로 호출해 ManagerGuard만 적용됐는지 함께 확인
    await ctx.db
      .insert(adminAccount)
      .values({ pk: randomUUID(), email: ADMIN, role: "admin" });
    const res = await http(ctx)
      .post("/api/manager/v1/auth/login")
      .send({
        code: `fake-idp-code:${ADMIN}`,
        redirect_uri: "http://localhost:5174/admin/callback",
        code_verifier: "e2e-verifier",
      })
      .expect(201);
    auth = `Bearer ${res.body.access_token}`;
  });
  afterEach(() => restoreSeed());
  afterAll(() => ctx.close());

  describe("Swagger 문서", () => {
    it("응답 형식 · 인증 · 에러 코드가 실제 동작과 맞음", () => {
      const document = SwaggerModule.createDocument(
        ctx.app,
        new DocumentBuilder().addBearerAuth().build(),
      );
      const collection = document.paths[BASE];
      const item = document.paths[`${BASE}/{pk}`];
      const order = document.paths[`${BASE}/order`];
      const operations = [
        [collection.get, 200, []],
        [collection.post, 201, [400, 409]],
        [order.put, 200, [400, 409]],
        [item.patch, 200, [400, 404, 409]],
        [item.delete, 200, [400, 404]],
      ] as const;

      for (const [operation, success, errors] of operations) {
        expect(operation?.tags).toEqual(["관심 분야"]);
        expect(operation?.security).toEqual([{ bearer: [] }]);
        expect(Object.keys(operation?.responses ?? {}).sort()).toEqual(
          [success, 401, ...errors].map(String).sort(),
        );
      }

      const itemRef = { $ref: "#/components/schemas/AdminInterestDto" };
      const bodyOf = (operation: typeof collection.get, status: number) =>
        JSON.stringify(operation?.responses[status]);
      const listBody = JSON.stringify({ type: "array", items: itemRef });
      expect(bodyOf(collection.get, 200)).toContain(listBody);
      expect(bodyOf(order.put, 200)).toContain(listBody);
      expect(bodyOf(collection.post, 201)).toContain(JSON.stringify(itemRef));
      expect(bodyOf(item.patch, 200)).toContain(JSON.stringify(itemRef));
      expect(bodyOf(item.delete, 200)).toContain("BaseResultDto");

      const schemas = document.components?.schemas as Record<
        string,
        { properties: Record<string, unknown>; required: string[] }
      >;
      expect(schemas.AdminInterestDto.required).toEqual([
        "pk",
        "name",
        "sort_order",
      ]);
      expect(schemas.AdminInterestNameRequestDto.properties.name).toMatchObject(
        { type: "string", maxLength: 50 },
      );
      expect(item.patch?.parameters).toEqual([
        expect.objectContaining({
          name: "pk",
          in: "path",
          schema: { type: "number" },
        }),
      ]);
    });
  });

  describe("권한", () => {
    it("토큰이 없으면 모든 API가 401", async () => {
      await http(ctx).get(BASE).expect(401);
      await http(ctx).post(BASE).send({ name: "x" }).expect(401);
      await http(ctx)
        .put(`${BASE}/order`)
        .send({ pks: [1] })
        .expect(401);
      await http(ctx).patch(`${BASE}/1`).send({ name: "x" }).expect(401);
      await http(ctx).delete(`${BASE}/1`).expect(401);
    });

    it("사용자 토큰은 모든 API가 401이고 목록은 그대로", async () => {
      const token = bearer(await signupStudent(ctx));

      await http(ctx).get(BASE).set("Authorization", token).expect(401);
      await http(ctx)
        .post(BASE)
        .set("Authorization", token)
        .send({ name: "x" })
        .expect(401);
      await http(ctx)
        .put(`${BASE}/order`)
        .set("Authorization", token)
        .send({ pks: [1] })
        .expect(401);
      await http(ctx)
        .patch(`${BASE}/1`)
        .set("Authorization", token)
        .send({ name: "x" })
        .expect(401);
      await http(ctx)
        .delete(`${BASE}/1`)
        .set("Authorization", token)
        .expect(401);

      expect(await ctx.db.select().from(interest)).toHaveLength(seed.length);
    });

    it("매니저 토큰은 앱 목록 API에서 401", async () => {
      await http(ctx).get(APP_LIST).set("Authorization", auth).expect(401);
    });
  });

  describe("목록 변경이 앱 API에 바로 반영", () => {
    it("추가 · 이름 수정 · 정렬 · 삭제", async () => {
      const session = await signupStudent(ctx);
      const names = seed.map((row) => row.name);
      expect(await appList(session)).toEqual(names);

      const created = await post("  우주  ").expect(201);
      expect(created.body).toEqual({
        pk: seed.at(-1)!.pk + 1,
        name: "우주",
        sort_order: seed.at(-1)!.sortOrder + 1,
      });
      expect(await appList(session)).toEqual([...names, "우주"]);

      const renamed = await patch(created.body.pk, "우주항공").expect(200);
      expect(renamed.body.name).toBe("우주항공");
      expect(await appList(session)).toEqual([...names, "우주항공"]);

      const pks = [created.body.pk, ...seed.map((row) => row.pk)];
      const reordered = await reorder(pks).expect(200);
      expect(reordered.body.map((r: { pk: number }) => r.pk)).toEqual(pks);
      expect(reordered.body[0]).toEqual({
        pk: created.body.pk,
        name: "우주항공",
        sort_order: 1,
      });
      expect(await appList(session)).toEqual(["우주항공", ...names]);
      expect((await adminList()).map((r) => r.pk)).toEqual(pks);

      const deleted = await remove(created.body.pk).expect(200);
      expect(deleted.body).toEqual({ result: "OK" });
      expect(await appList(session)).toEqual(names);
    });

    it("쓰기를 처리하지 않은 인스턴스는 재조회 때 반영 (주기 재조회와 같은 메서드)", async () => {
      const session = await signupStudent(ctx);
      const names = seed.map((row) => row.name);

      // 다른 인스턴스의 쓰기: 이 앱의 캐시는 건드리지 않고 DB만 바뀜
      await ctx.db
        .update(interest)
        .set({ name: "다른 인스턴스" })
        .where(eq(interest.pk, seed[0].pk));
      expect(await appList(session)).toEqual(names);

      await ctx.app.get(InterestService).refresh();
      expect(await appList(session)).toEqual([
        "다른 인스턴스",
        ...names.slice(1),
      ]);
    });

    it("주기 재조회가 1분 간격 cron으로 등록됨", () => {
      const job = ctx.app
        .get(SchedulerRegistry)
        .getCronJob("interest-cache-refresh");

      expect(job.cronTime.source).toBe(CronExpression.EVERY_MINUTE);
    });

    it("마지막 항목까지 지우면 빈 목록. 다시 추가하면 pk는 1부터", async () => {
      const session = await signupStudent(ctx);
      for (const row of seed) {
        await remove(row.pk).expect(200);
      }
      expect(await appList(session)).toEqual([]);

      const created = await post("우주").expect(201);
      expect(created.body).toEqual({ pk: 1, name: "우주", sort_order: 1 });
      expect(await appList(session)).toEqual(["우주"]);
    });
  });

  describe("잘못된 요청", () => {
    it("빈 이름 · 50자 초과 · 문자열 아님은 400", async () => {
      for (const name of ["", "   ", "가".repeat(51), 1, null, undefined]) {
        await post(name).expect(400);
        await patch(seed[0].pk, name).expect(400);
      }
      await post("가".repeat(50)).expect(201);
    });

    it("같은 이름은 409. 공백 · 유니코드 표현이 달라도 같은 이름", async () => {
      await post(seed[0].name).expect(409);
      await post(` ${seed[0].name} `).expect(409);
      await post(seed[0].name.normalize("NFD")).expect(409);
      await patch(seed[1].pk, seed[0].name).expect(409);
    });

    it("자기 이름 그대로 수정은 성공", async () => {
      await patch(seed[0].pk, seed[0].name).expect(200);
    });

    it("잘못된 pk는 400, 없는 pk는 404", async () => {
      for (const pk of ["abc", "0", "-1", "1.5", "99999999999"]) {
        await patch(pk, "우주").expect(400);
        await remove(pk).expect(400);
      }
      await patch(2147483647, "우주").expect(404);
      await remove(2147483647).expect(404);
    });

    it("정렬: 형식 오류는 400, 현재 목록과 다르면 409이고 순서는 그대로", async () => {
      const pks = seed.map((row) => row.pk);
      for (const body of [
        [],
        "1",
        null,
        [pks[0], pks[0]],
        ["1"],
        [1.5],
        [0],
        [99999999999],
      ]) {
        await reorder(body).expect(400);
      }
      await reorder(pks.slice(1)).expect(409);
      await reorder([...pks.slice(1), 2147483647]).expect(409);
      await reorder([...pks, 2147483647]).expect(409);

      expect((await adminList()).map((r) => r.pk)).toEqual(pks);
    });
  });

  describe("동시 쓰기", () => {
    it("다른 이름을 동시에 추가해도 모두 성공 (pk 충돌 없음)", async () => {
      const results = await Promise.all(
        ["가", "나", "다", "라", "마"].map((name) => post(name)),
      );

      expect(results.map((res) => res.status)).toEqual(Array(5).fill(201));
      expect(new Set(results.map((res) => res.body.pk)).size).toBe(5);
    });

    it("같은 이름을 동시에 추가하면 하나만 성공하고 나머지는 409", async () => {
      const results = await Promise.all([post("우주"), post("우주")]);

      expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    });
  });

  describe("이미 저장된 옛 값", () => {
    // reset으로 재학생이 한 명뿐이라 최신 버전이 그 학생의 프로필
    const savedInterests = async () => {
      const rows = await ctx.db
        .select({ interests: studentProfile.interests })
        .from(studentProfile)
        .orderBy(desc(studentProfile.version))
        .limit(1);
      return rows[0].interests;
    };

    it.each(["rename", "delete"])(
      "%s 후에도 프로필의 값은 그대로이고, 옛 값으로 다시 저장해도 막히지 않음",
      async (action) => {
        const session = await signupStudent(ctx);
        const oldName = seed[0].name;
        expect(await savedInterests()).toEqual([oldName]);

        if (action === "rename") {
          await patch(seed[0].pk, "새 이름").expect(200);
        } else {
          await remove(seed[0].pk).expect(200);
        }
        expect(await appList(session)).not.toContain(oldName);
        expect(await savedInterests()).toEqual([oldName]);

        await saveStudentInfo(ctx, session, {
          interests: [oldName, seed[1].name],
        });
        expect(await savedInterests()).toEqual([oldName, seed[1].name]);
      },
    );
  });
});
