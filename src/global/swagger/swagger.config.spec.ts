import { INestApplication, Type } from "@nestjs/common";
import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from "@nestjs/swagger";
import { Test } from "@nestjs/testing";
import * as request from "supertest";
import { App } from "supertest/types";
import { CheersGraduatedController } from "@src/cheers/cheers-graduated.controller";
import { CheersStudentController } from "@src/cheers/cheers-student.controller";
import { ConsentController } from "@src/consent/consent.controller";
import { FileController } from "@src/file/file.controller";
import { GraduatedController } from "@src/graduated/graduated.controller";
import { HealthController } from "@src/health/health.controller";
import { HealthService } from "@src/health/health.service";
import { StudentController } from "@src/student/student.controller";
import { UserController } from "@src/user/user.controller";
import { isSwaggerEnabled, setupSwagger } from "./swagger.config";

const createConfig = (env: Record<string, string | undefined>) =>
  ({ get: (key: string) => env[key] }) as unknown as ConfigService;

const CONTROLLERS: Type<unknown>[] = [
  HealthController,
  UserController,
  ConsentController,
  StudentController,
  GraduatedController,
  FileController,
  CheersStudentController,
  CheersGraduatedController,
];

describe("isSwaggerEnabled", () => {
  it.each(["true", " true "])("is on for %p", (value) => {
    expect(isSwaggerEnabled(createConfig({ SWAGGER_ENABLED: value }))).toBe(
      true,
    );
  });

  it.each([undefined, "", "   ", "false", " false "])(
    "is off for %p",
    (value) => {
      expect(isSwaggerEnabled(createConfig({ SWAGGER_ENABLED: value }))).toBe(
        false,
      );
    },
  );

  it.each(["1", "0", "yes", "TRUE", "ture"])("throws on %s", (value) => {
    expect(() =>
      isSwaggerEnabled(createConfig({ SWAGGER_ENABLED: value })),
    ).toThrow(`SWAGGER_ENABLED must be true or false (got "${value}")`);
  });
});

describe("setupSwagger", () => {
  let app: INestApplication<App>;

  const startApp = async (env: Record<string, string | undefined>) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthService, useValue: { isReady: async () => true } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    setupSwagger(app, createConfig(env));
    await app.init();
  };

  afterEach(async () => {
    await app.close();
  });

  it("serves the UI, its static files and the JSON when enabled", async () => {
    await startApp({ SWAGGER_ENABLED: "true" });

    const ui = await request(app.getHttpServer()).get("/api-docs").expect(200);
    expect(ui.headers["content-type"]).toContain("text/html");
    await request(app.getHttpServer())
      .get("/api-docs/swagger-ui.css")
      .expect(200);

    const json = await request(app.getHttpServer())
      .get("/api-docs-json")
      .expect(200);
    const document = json.body as OpenAPIObject;
    expect(document.paths["/health"]).toBeDefined();
    expect(document.paths["/health/ready"].get?.responses).toHaveProperty(
      "503",
    );
    expect(document.components?.securitySchemes?.bearer).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
  });

  it.each([{}, { SWAGGER_ENABLED: "" }, { SWAGGER_ENABLED: "false" }])(
    "does not register the routes for %j",
    async (env) => {
      await startApp(env);

      for (const path of [
        "/api-docs",
        "/api-docs/swagger-ui.css",
        "/api-docs-json",
      ]) {
        const response = await request(app.getHttpServer()).get(path);
        expect(response.status).toBe(404);
      }
      const health = await request(app.getHttpServer()).get("/health");
      expect(health.status).toBe(200);
    },
  );

  it("does not open the YAML route", async () => {
    await startApp({ SWAGGER_ENABLED: "true" });

    const response = await request(app.getHttpServer()).get("/api-docs-yaml");
    expect(response.status).toBe(404);
  });
});

describe("API document", () => {
  let document: OpenAPIObject;

  beforeAll(async () => {
    // 문서 생성에는 서비스 구현이 필요 없어 의존성을 전부 mock으로 채움
    const moduleRef = await Test.createTestingModule({
      controllers: CONTROLLERS,
    })
      .useMocker(() => ({}))
      .compile();
    const app = moduleRef.createNestApplication();
    document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    await app.close();
  });

  const handlerOf = (controller: Type<unknown>, name: string) =>
    (controller.prototype as Record<string, object>)[name];

  // 라우트 데코레이터가 붙은 메서드만 (private helper 제외)
  const handlersOf = (controller: Type<unknown>): string[] =>
    Object.getOwnPropertyNames(controller.prototype).filter(
      (name) =>
        name !== "constructor" &&
        Reflect.getMetadata(PATH_METADATA, handlerOf(controller, name)) !==
          undefined,
    );

  const hasGuard = (controller: Type<unknown>, name: string): boolean =>
    Boolean(Reflect.getMetadata(GUARDS_METADATA, controller)) ||
    Boolean(Reflect.getMetadata(GUARDS_METADATA, handlerOf(controller, name)));

  const operations = () =>
    Object.values(document.paths).flatMap((item) => Object.values(item)) as {
      operationId: string;
      security?: Record<string, string[]>[];
    }[];

  it("builds DTO schemas through the Swagger plugin like nest build", () => {
    const schemas = document.components?.schemas as Record<
      string,
      { properties: Record<string, unknown>; required?: string[] }
    >;

    expect(schemas.LoginRequestDto.required).toEqual([
      "provider",
      "type",
      "token",
    ]);
    expect(schemas.LoginRequestDto.properties.provider).toMatchObject({
      enum: ["google"],
    });
    expect(schemas.UserInfoDto.properties.next_step).toMatchObject({
      enum: ["consent", "verify", "profile"],
      nullable: true,
    });
    expect(schemas.PageResponseDto.properties.items).toMatchObject({
      type: "array",
    });
  });

  it("documents the page query as optional", () => {
    const parameters = document.paths["/api/v1/cheers"].get?.parameters as {
      name: string;
      required: boolean;
    }[];

    expect(
      Object.fromEntries(parameters.map((p) => [p.name, p.required])),
    ).toEqual({ page: false, size: false, sort: false });
  });

  it("lists every route handler", () => {
    const handlers = CONTROLLERS.flatMap(handlersOf);

    expect(handlers).toHaveLength(25);
    expect(operations()).toHaveLength(handlers.length);
  });

  it("marks exactly the guarded handlers with bearer auth", () => {
    const expected = CONTROLLERS.flatMap((controller) =>
      handlersOf(controller).map((name) => [
        `${controller.name}_${name}`,
        hasGuard(controller, name),
      ]),
    );

    const actual = operations().map((operation) => [
      operation.operationId.replace(/_v\d+$/, ""),
      operation.security?.some((item) => "bearer" in item) ?? false,
    ]);

    expect(Object.fromEntries(actual)).toEqual(Object.fromEntries(expected));
  });

  it.each([
    ["/api/v1/cheers", "CheersCardDto"],
    ["/api/v1/cheers/sent", "SentRequestDto"],
    ["/api/v1/cheers/received", "ReceivedRequestDto"],
  ])("documents the page items of %s", (path, item) => {
    expect(JSON.stringify(document.paths[path].get?.responses[200])).toContain(
      `#/components/schemas/${item}`,
    );
    expect(document.components?.schemas?.[item]).toBeDefined();
  });
});
