import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Test } from "@nestjs/testing";
import { CompanyService } from "@src/company/company.service";
import { ManagerGuard } from "@src/manager/guard/manager.guard";
import { AdminCompanyController } from "./admin-company.controller";
import { AdminCompanyService } from "./admin-company.service";
import { CompanyImportService } from "./company-import.service";

describe("회사 일괄 등록 Swagger", () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminCompanyController],
      providers: [
        AdminCompanyService,
        CompanyService,
        CompanyImportService,
      ].map((provide) => ({ provide, useValue: {} })),
    })
      .overrideGuard(ManagerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  it("두 경로에 multipart 파일 입력과 성공 · 오류 응답 스키마를 노출", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    for (const [path, status] of [
      ["import/preview", "200"],
      ["import", "201"],
    ]) {
      const operation = document.paths[`/api/manager/v1/company/${path}`].post!;
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
      expect(operation.responses[status]).toMatchObject({
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/CompanyImportResultDto" },
          },
        },
      });
      for (const code of ["400", "401", "413"])
        expect(operation.responses[code]).toBeDefined();
    }
    expect(document.components?.schemas?.CompanyImportResultDto).toMatchObject({
      properties: {
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/CompanyImportRowDto" },
        },
      },
    });
  });
});
