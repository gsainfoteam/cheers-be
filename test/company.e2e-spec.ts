import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { adminAccount } from "@drizzle/schema/admin-account";
import { companyAlias } from "@drizzle/schema/company-alias";
import { createE2eApp, E2eContext } from "./support/app";
import {
  bearer,
  getInfo,
  graduatedInfoBody,
  http,
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

describe("company alias", () => {
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
  afterAll(() => ctx.close());

  it("registers an unknown typed name for review and reuses it for the same name written differently", async () => {
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

  it("lets graduates find a pre-registered company by any of its names", async () => {
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

  it("merges a typed company into a registered one", async () => {
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

  it("uploads a logo and shows it on the graduate cards", async () => {
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

  it("does not delete a company picked by graduates", async () => {
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
});
