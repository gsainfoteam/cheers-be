import { eq } from "drizzle-orm";
import { companyAlias } from "@drizzle/schema/company-alias";
import { createE2eApp, E2eContext } from "./support/app";
import {
  bearer,
  getInfo,
  graduatedInfoBody,
  http,
  loginManager,
  Session,
  signupGraduated,
  signupStudent,
} from "./support/flows";

const SEARCH = "/api/v1/company";
const ADMIN_BASE = "/api/manager/v1/company";
const ADMIN = "admin@gm.gist.ac.kr";
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

type AdminCompany = {
  company_id: number;
  name: string;
  logo_url: string | null;
  needs_review: boolean;
  names: { name_id: number; name: string }[];
  graduated_count: number;
};

describe("회사 alias", () => {
  let ctx: E2eContext;
  let auth: string;

  const search = async (session: Session, q: string) => {
    const res = await http(ctx)
      .get(SEARCH)
      .query({ q })
      .set("Authorization", bearer(session))
      .expect(200);
    return res.body as { company_id: number; name: string }[];
  };
  const adminList = async (query: Record<string, string> = {}) => {
    const res = await http(ctx)
      .get(ADMIN_BASE)
      .query(query)
      .set("Authorization", auth)
      .expect(200);
    return res.body.items as AdminCompany[];
  };
  const createCompany = (body: object) =>
    http(ctx).post(ADMIN_BASE).set("Authorization", auth).send(body);
  const cards = async (session: Session) => {
    const res = await http(ctx)
      .get("/api/v1/cheers")
      .set("Authorization", bearer(session))
      .expect(200);
    return res.body.items as {
      nickname: string;
      company: string;
      company_logo_url: string | null;
    }[];
  };

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  beforeEach(async () => {
    await ctx.reset();
    auth = await loginManager(ctx, ADMIN, "admin");
  });
  afterAll(() => ctx.close());

  it("모르는 이름은 검토 대상으로 등록하고, 표기만 다른 같은 이름은 그 회사를 다시 씀", async () => {
    const first = await signupGraduated(ctx, { company_name: "인포 테크" });
    await signupGraduated(ctx, { company_name: "  인포   테크 " });

    const queue = await adminList();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      name: "인포 테크",
      needs_review: true,
      graduated_count: 2,
    });

    // 어드민 확인 전 회사도 검색됨
    expect(await search(first, "인포")).toEqual([
      expect.objectContaining({
        company_id: queue[0].company_id,
        name: "인포 테크",
        matched_name: "인포 테크",
        logo_url: null,
      }),
    ]);
    expect((await getInfo(ctx, first)).graduated.profile).toMatchObject({
      company_id: queue[0].company_id,
      company: "인포 테크",
    });
  });

  it("미리 등록한 회사를 어느 표기로든 찾음", async () => {
    const created = await createCompany({
      name: "Microsoft",
      names: ["마이크로소프트", "마소"],
    }).expect(201);
    expect(created.body).toMatchObject({
      name: "Microsoft",
      needs_review: false,
      names: [
        expect.objectContaining({ name: "Microsoft" }),
        expect.objectContaining({ name: "마이크로소프트" }),
        expect.objectContaining({ name: "마소" }),
      ],
    });
    await createCompany({ name: "MS", names: ["마소"] }).expect(409);

    const graduate = await signupGraduated(ctx, {
      company_id: created.body.company_id,
      company_name: undefined,
    });
    expect(await search(graduate, "마")).toEqual([
      expect.objectContaining({ name: "Microsoft", matched_name: "마소" }),
    ]);
    // 어드민 화면의 검색 미리보기도 현업자 검색과 같은 결과
    const preview = await http(ctx)
      .get(`${ADMIN_BASE}/search`)
      .query({ q: "마" })
      .set("Authorization", auth)
      .expect(200);
    expect(preview.body).toEqual(await search(graduate, "마"));
    // 등록된 표기를 직접 입력해도 그 회사로 연결 (새 회사가 생기지 않음)
    await signupGraduated(ctx, { company_name: "마이크로소프트" });
    expect(await adminList()).toEqual([
      expect.objectContaining({ name: "Microsoft", graduated_count: 2 }),
    ]);

    const student = await signupStudent(ctx);
    expect((await cards(student)).map((c) => c.company)).toEqual([
      "Microsoft",
      "Microsoft",
    ]);
    await http(ctx)
      .get(SEARCH)
      .query({ q: "마" })
      .set("Authorization", bearer(student))
      .expect(403);
  });

  it("직접 입력한 회사를 등록된 회사로 병합", async () => {
    const target = await createCompany({ name: "Microsoft" }).expect(201);
    const graduate = await signupGraduated(ctx, {
      company_name: "MS코리아",
    });
    // 검토가 필요한 회사가 맨 위
    const [pending, registered] = await adminList();
    expect(pending).toMatchObject({ name: "MS코리아", needs_review: true });
    expect(registered).toMatchObject({
      name: "Microsoft",
      needs_review: false,
    });

    const merged = await http(ctx)
      .post(`${ADMIN_BASE}/${pending.company_id}/merge`)
      .set("Authorization", auth)
      .send({ target_id: target.body.company_id })
      .expect(200);
    expect(merged.body).toMatchObject({
      company_id: target.body.company_id,
      graduated_count: 1,
      names: [
        expect.objectContaining({ name: "Microsoft" }),
        expect.objectContaining({ name: "MS코리아" }),
      ],
    });
    expect(await adminList()).toEqual([
      expect.objectContaining({ name: "Microsoft", needs_review: false }),
    ]);

    // 이후 같은 표기로 입력하면 병합된 회사로
    expect(await search(graduate, "ms코리아")).toEqual([
      expect.objectContaining({ name: "Microsoft" }),
    ]);
    expect((await getInfo(ctx, graduate)).graduated.profile).toMatchObject({
      company_id: target.body.company_id,
      company: "Microsoft",
    });

    // 병합으로 사라진 회사를 고르면 404
    await http(ctx)
      .post("/api/v1/user/graduated/info")
      .set("Authorization", bearer(graduate))
      .send(
        graduatedInfoBody({
          company_id: pending.company_id,
          company_name: undefined,
        }),
      )
      .expect(404);
  });

  it("로고를 올리면 현업자 카드에 보임", async () => {
    const company = await createCompany({ name: "Microsoft" }).expect(201);
    await signupGraduated(ctx, {
      company_id: company.body.company_id,
      company_name: undefined,
    });

    const upload = await http(ctx)
      .post(`${ADMIN_BASE}/logo/upload-url`)
      .set("Authorization", auth)
      .send({ content_type: "image/png", size: PNG_BYTES.length })
      .expect(201);
    ctx.s3.put(upload.body.key, PNG_BYTES);
    await http(ctx)
      .put(`${ADMIN_BASE}/${company.body.company_id}/logo`)
      .set("Authorization", auth)
      .send({ key: upload.body.key })
      .expect(200);

    const [row] = await ctx.db
      .select()
      .from(companyAlias)
      .where(eq(companyAlias.pk, company.body.company_id));
    expect(row.logoKey).toMatch(/^company-logo\/.+\.png$/);
    expect(ctx.s3.objects.has(row.logoKey!)).toBe(true);

    const student = await signupStudent(ctx);
    const [card] = await cards(student);
    expect(card.company_logo_url).toContain(row.logoKey);
  });

  it("현업자가 고른 회사는 지우지 않음", async () => {
    await signupGraduated(ctx, { company_name: "인포테크" });
    const [company] = await adminList();

    await http(ctx)
      .delete(`${ADMIN_BASE}/${company.company_id}`)
      .set("Authorization", auth)
      .expect(409);

    const unused = await createCompany({ name: "Google" }).expect(201);
    await http(ctx)
      .delete(`${ADMIN_BASE}/${unused.body.company_id}`)
      .set("Authorization", auth)
      .expect(200);
  });

  describe("이름 변경 · 표기 관리", () => {
    const patch = (pk: number, body: object) =>
      http(ctx)
        .patch(`${ADMIN_BASE}/${pk}`)
        .set("Authorization", auth)
        .send(body);
    const addName = (pk: number, name: string) =>
      http(ctx)
        .post(`${ADMIN_BASE}/${pk}/name`)
        .set("Authorization", auth)
        .send({ name });
    const removeName = (pk: number, namePk: number) =>
      http(ctx)
        .delete(`${ADMIN_BASE}/${pk}/name/${namePk}`)
        .set("Authorization", auth);

    it("이름을 바꾸면 앱 검색 · 현업자 카드에 새 이름이 보이고, 예전 이름으로도 찾음", async () => {
      const graduate = await signupGraduated(ctx, { company_name: "인포텍" });
      const [company] = await adminList();
      expect(company.needs_review).toBe(true);

      const renamed = await patch(company.company_id, {
        name: "인포테크",
      }).expect(200);
      expect(renamed.body).toMatchObject({
        name: "인포테크",
        needs_review: true,
      });
      expect(renamed.body.names.map((n: { name: string }) => n.name)).toEqual(
        expect.arrayContaining(["인포텍", "인포테크"]),
      );

      // 예전 이름은 표기로 남아 그대로 검색되고, 결과에는 새 이름이 보임
      for (const q of ["인포테크", "인포텍"]) {
        expect(await search(graduate, q)).toEqual([
          expect.objectContaining({
            company_id: company.company_id,
            name: "인포테크",
            matched_name: q,
          }),
        ]);
      }
      const student = await signupStudent(ctx);
      expect((await cards(student))[0].company).toBe("인포테크");
    });

    it("검토 완료하면 검토 대기 표시가 꺼지고 목록에서 검토 대기 회사 아래로 내려감", async () => {
      await signupGraduated(ctx, { company_name: "첫회사" });
      await signupGraduated(ctx, { company_name: "둘째회사" });
      const before = await adminList();
      expect(before.map((c) => c.needs_review)).toEqual([true, true]);
      const target = before[0];

      const reviewed = await patch(target.company_id, {
        needs_review: false,
      }).expect(200);
      expect(reviewed.body).toMatchObject({
        name: target.name,
        needs_review: false,
      });

      const after = await adminList();
      expect(after.map((c) => [c.company_id, c.needs_review])).toEqual([
        [before[1].company_id, true],
        [target.company_id, false],
      ]);
    });

    it("표기를 추가하면 그 표기로 찾고, 지우면 더는 찾지 못함", async () => {
      const graduate = await signupGraduated(ctx);
      const company = await createCompany({ name: "Amazon" }).expect(201);
      const pk = company.body.company_id;

      const added = await addName(pk, "아마존").expect(201);
      const alias = added.body.names.find(
        (n: { name: string }) => n.name === "아마존",
      );
      expect(alias).toBeDefined();
      expect(await search(graduate, "아마존")).toEqual([
        expect.objectContaining({
          company_id: pk,
          name: "Amazon",
          matched_name: "아마존",
        }),
      ]);

      const removed = await removeName(pk, alias.name_id).expect(200);
      expect(
        removed.body.names.map((n: { name: string }) => n.name),
      ).not.toContain("아마존");
      expect(await search(graduate, "아마존")).toEqual([]);
    });

    it("회사 이름 표기는 지울 수 없고, 다른 회사의 표기는 404", async () => {
      const amazon = await createCompany({ name: "Amazon" }).expect(201);
      const google = await createCompany({
        name: "Google",
        names: ["구글"],
      }).expect(201);
      const own = amazon.body.names.find(
        (n: { name: string }) => n.name === "Amazon",
      );
      const googleAlias = google.body.names.find(
        (n: { name: string }) => n.name === "구글",
      );

      await removeName(amazon.body.company_id, own.name_id).expect(400);
      await removeName(amazon.body.company_id, googleAlias.name_id).expect(404);
    });

    it("다른 회사에 등록된 표기는 등록 · 이름 변경 · 표기 추가 모두 409이고 바뀌지 않음", async () => {
      const amazon = await createCompany({ name: "Amazon" }).expect(201);
      await createCompany({ name: "Google", names: ["구글"] }).expect(201);
      const pk = amazon.body.company_id;

      await createCompany({ name: "구글" }).expect(409);
      await createCompany({ name: "Apple", names: ["Google"] }).expect(409);
      await patch(pk, { name: "구글" }).expect(409);
      await addName(pk, " google ").expect(409);

      const [row] = (await adminList()).filter((c) => c.company_id === pk);
      expect(row).toMatchObject({ name: "Amazon" });
      expect(row.names.map((n) => n.name)).toEqual(["Amazon"]);
    });

    it("없는 회사는 404, pk · 요청 형식 오류와 자기 자신 병합은 400", async () => {
      const company = await createCompany({ name: "Amazon" }).expect(201);
      const pk = company.body.company_id;
      const missing = pk + 1000;

      await patch(missing, { name: "새이름" }).expect(404);
      await addName(missing, "새표기").expect(404);
      await http(ctx)
        .delete(`${ADMIN_BASE}/${missing}`)
        .set("Authorization", auth)
        .expect(404);
      await http(ctx)
        .post(`${ADMIN_BASE}/${missing}/merge`)
        .set("Authorization", auth)
        .send({ target_id: pk })
        .expect(404);
      await http(ctx)
        .post(`${ADMIN_BASE}/${pk}/merge`)
        .set("Authorization", auth)
        .send({ target_id: missing })
        .expect(404);
      const upload = await http(ctx)
        .post(`${ADMIN_BASE}/logo/upload-url`)
        .set("Authorization", auth)
        .send({ content_type: "image/png", size: PNG_BYTES.length })
        .expect(201);
      ctx.s3.put(upload.body.key, PNG_BYTES);
      await http(ctx)
        .put(`${ADMIN_BASE}/${missing}/logo`)
        .set("Authorization", auth)
        .send({ key: upload.body.key })
        .expect(404);

      await http(ctx)
        .post(`${ADMIN_BASE}/${pk}/merge`)
        .set("Authorization", auth)
        .send({ target_id: pk })
        .expect(400);
      await patch(pk, { name: "   " }).expect(400);
      await patch(pk, { needs_review: "no" }).expect(400);
      await addName(pk, "").expect(400);
      for (const bad of ["abc", "0", "2147483648"]) {
        await http(ctx)
          .patch(`${ADMIN_BASE}/${bad}`)
          .set("Authorization", auth)
          .send({ name: "새이름" })
          .expect(400);
      }
    });
  });

  describe("로고 업로드 오류", () => {
    const uploadUrl = (manager: string, body: object) =>
      http(ctx)
        .post(`${ADMIN_BASE}/logo/upload-url`)
        .set("Authorization", manager)
        .send(body);
    const putLogo = (pk: number, key: string) =>
      http(ctx)
        .put(`${ADMIN_BASE}/${pk}/logo`)
        .set("Authorization", auth)
        .send({ key });
    const logoKeyOf = async (pk: number) => {
      const [row] = await ctx.db
        .select()
        .from(companyAlias)
        .where(eq(companyAlias.pk, pk));
      return row.logoKey;
    };

    it("허용되지 않은 형식은 400, 2MB를 넘으면 413", async () => {
      await uploadUrl(auth, { content_type: "image/gif", size: 10 }).expect(
        400,
      );
      await uploadUrl(auth, {
        content_type: "image/png",
        size: 2 * 1024 * 1024 + 1,
      }).expect(413);
    });

    it("다른 어드민이 받은 key · 업로드하지 않은 key · 내용이 이미지가 아닌 파일은 400이고 로고가 그대로", async () => {
      const company = await createCompany({ name: "Amazon" }).expect(201);
      const pk = company.body.company_id;

      const otherAuth = await loginManager(
        ctx,
        "other-admin@gm.gist.ac.kr",
        "admin",
      );
      const others = await uploadUrl(otherAuth, {
        content_type: "image/png",
        size: PNG_BYTES.length,
      }).expect(201);
      ctx.s3.put(others.body.key, PNG_BYTES);
      await putLogo(pk, others.body.key).expect(400);

      const notUploaded = await uploadUrl(auth, {
        content_type: "image/png",
        size: PNG_BYTES.length,
      }).expect(201);
      await putLogo(pk, notUploaded.body.key).expect(400);

      const text = await uploadUrl(auth, {
        content_type: "image/png",
        size: 8,
      }).expect(201);
      ctx.s3.put(text.body.key, Buffer.from("not png!"));
      await putLogo(pk, text.body.key).expect(400);
      // 정책과 다른 파일은 tmp에서 지움
      expect(ctx.s3.objects.has(text.body.key)).toBe(false);

      expect(await logoKeyOf(pk)).toBeNull();
    });
  });
});
