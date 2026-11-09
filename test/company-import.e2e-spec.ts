import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Workbook } from "exceljs";
import { companyAlias } from "@drizzle/schema/company-alias";
import { companyName } from "@drizzle/schema/company-name";
import { createE2eApp, E2eContext } from "./support/app";
import { bearer, http, loginManager, signupStudent } from "./support/flows";

const BASE = "/api/manager/v1/company";
const CSV =
  "company name,alias1,alias2\nMicrosoft,마이크로소프트,MS\nGoogle,구글,GOOG\n";

describe("회사 Excel · CSV 일괄 등록", () => {
  let ctx: E2eContext;
  let auth: string;
  const upload = (path: string, text = CSV, filename = "companies.csv") =>
    http(ctx)
      .post(`${BASE}/${path}`)
      .set("Authorization", auth)
      .attach("file", Buffer.from(text), filename);
  const snapshot = async () => ({
    companies: await ctx.db.select().from(companyAlias),
    names: await ctx.db.select().from(companyName),
  });

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  beforeEach(async () => {
    await ctx.reset();
    auth = await loginManager(ctx, "admin@gm.gist.ac.kr", "admin");
  });
  afterAll(() => ctx.close());

  it("미리보기는 쓰지 않고, 확정은 회사 · 표기를 만들며 재업로드는 멱등", async () => {
    const before = await snapshot();
    const preview = await upload("import/preview").expect(200);
    expect(preview.body).toMatchObject({
      valid: true,
      created_companies: 2,
      added_names: 6,
    });
    expect(await snapshot()).toEqual(before);
    const committed = await upload("import").expect(201);
    expect(committed.body).toEqual(preview.body);
    const after = await snapshot();
    expect(after.companies).toHaveLength(2);
    expect(after.companies.every((row) => row.needsReview === false)).toBe(
      true,
    );
    expect(after.names.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "Microsoft",
        "MS",
        "마이크로소프트",
        "Google",
        "구글",
        "GOOG",
      ]),
    );
    const again = await upload("import").expect(201);
    expect(again.body).toMatchObject({
      valid: true,
      created_companies: 0,
      updated_companies: 0,
      added_names: 0,
      skipped_rows: 2,
    });
    expect(await snapshot()).toEqual(after);
  });

  it("xlsx를 읽고 같은 회사의 반복 행과 기존 회사의 새 별칭을 등록", async () => {
    const book = new Workbook();
    book.addWorksheet("회사").addRows([
      ["company name", "alias1"],
      ["Microsoft", "MS"],
      ["microsoft", "마소"],
    ]);
    await http(ctx)
      .post(`${BASE}/import`)
      .set("Authorization", auth)
      .attach(
        "file",
        Buffer.from(await book.xlsx.writeBuffer()),
        "companies.xlsx",
      )
      .expect(201);
    const result = await upload(
      "import",
      "company name,alias1\nMS,마이크로소프트",
    ).expect(201);
    expect(result.body).toMatchObject({
      created_companies: 0,
      updated_companies: 1,
      added_names: 1,
    });
    const after = await snapshot();
    expect(after.companies).toHaveLength(1);
    expect(after.companies[0].name).toBe("Microsoft");
    expect(after.names).toHaveLength(4);
  });

  it("반복 대표명의 뒤 행에서 찾은 기존 회사에 앞 행도 함께 추가", async () => {
    await upload("import").expect(201);
    const result = await upload(
      "import",
      "company name,alias1\nNew Microsoft,새표기\nnew microsoft,MS",
    ).expect(201);
    expect(result.body).toMatchObject({
      valid: true,
      created_companies: 0,
      updated_companies: 1,
      added_names: 2,
    });
    const after = await snapshot();
    expect(after.companies).toHaveLength(2);
    const company = after.companies.find((row) => row.name === "Microsoft")!;
    expect(
      after.names
        .filter((row) => row.aliasPk === company.pk)
        .map((row) => row.name),
    ).toEqual(expect.arrayContaining(["New Microsoft", "새표기", "MS"]));
  });

  it("회사 간 충돌은 미리보기에 표시하고 확정 시 정상 행도 함께 취소", async () => {
    await upload("import").expect(201);
    const before = await snapshot();
    const conflicting = "company name,alias1\nNew,새회사\nMS,구글";
    const preview = await upload("import/preview", conflicting).expect(200);
    expect(preview.body.valid).toBe(false);
    expect(preview.body.rows[1].action).toBe("error");
    await upload("import", conflicting).expect(400);
    expect(await snapshot()).toEqual(before);
    await upload("import", "company name,alias1\nA,공유\nB,공유").expect(400);
    expect(await snapshot()).toEqual(before);
  });

  it("동시에 같은 파일을 확정해도 회사와 표기는 중복되지 않음", async () => {
    const results = await Promise.all([upload("import"), upload("import")]);
    expect(results.map((res) => res.status)).toEqual([201, 201]);
    const after = await snapshot();
    expect(after.companies).toHaveLength(2);
    expect(after.names).toHaveLength(6);
  });

  it("잘못된 헤더 · 확장자 · 손상 파일 · 파일 누락은 400, 2MB 초과는 413", async () => {
    for (const path of ["import/preview", "import"]) {
      await upload(path, "name,alias\n회사,별칭").expect(400);
      await upload(path, CSV, "companies.txt").expect(400);
      await upload(path, "broken", "companies.xlsx").expect(400);
      await http(ctx)
        .post(`${BASE}/${path}`)
        .set("Authorization", auth)
        .expect(400);
      await upload(path, "a".repeat(2 * 1024 * 1024 + 1)).expect(413);
    }
    expect((await snapshot()).companies).toHaveLength(0);
  });

  it("인증되지 않았거나 일반 사용자는 접근 불가", async () => {
    const student = await signupStudent(ctx);
    for (const path of ["import/preview", "import"]) {
      const unauthenticated = await http(ctx)
        .post(`${BASE}/${path}`)
        .attach("file", Buffer.from(CSV), "a.csv");
      expect([401, 403]).toContain(unauthenticated.status);
      const nonManager = await http(ctx)
        .post(`${BASE}/${path}`)
        .set("Authorization", bearer(student))
        .attach("file", Buffer.from(CSV), "a.csv");
      expect([401, 403]).toContain(nonManager.status);
    }
  });

  it("Swagger에 multipart 파일 입력과 결과 스키마 표시", () => {
    const document = SwaggerModule.createDocument(
      ctx.app,
      new DocumentBuilder().build(),
    );
    for (const path of ["import/preview", "import"]) {
      const operation = document.paths[`${BASE}/${path}`].post!;
      expect(operation.requestBody).toMatchObject({
        content: {
          "multipart/form-data": {
            schema: {
              required: ["file"],
              properties: { file: { type: "string", format: "binary" } },
            },
          },
        },
      });
      expect(
        operation.responses[path.endsWith("preview") ? "200" : "201"],
      ).toBeDefined();
    }
    expect(document.components?.schemas?.CompanyImportResultDto).toHaveProperty(
      "properties.rows",
    );
  });
});
