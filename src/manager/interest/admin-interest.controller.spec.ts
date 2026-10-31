import { DocumentBuilder, OpenAPIObject, SwaggerModule } from "@nestjs/swagger";
import { Test } from "@nestjs/testing";
import { AdminInterestController } from "@src/manager/interest/admin-interest.controller";

const BASE = "/api/manager/v1/interest";

// 단위 테스트 설정만 nest build와 같은 Swagger 플러그인을 거침 (e2e 설정은 거치지 않음)
describe("AdminInterestController API document", () => {
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminInterestController],
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

  it("응답 형식 · 인증 · 에러 코드가 실제 동작과 맞음", () => {
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
    const listSchema = JSON.stringify({ type: "array", items: itemRef });
    const bodyOf = (operation: typeof collection.get, status: number) =>
      JSON.stringify(operation?.responses[status]);

    expect(bodyOf(collection.get, 200)).toContain(listSchema);
    expect(bodyOf(order.put, 200)).toContain(listSchema);
    expect(bodyOf(collection.post, 201)).toContain(JSON.stringify(itemRef));
    expect(bodyOf(item.patch, 200)).toContain(JSON.stringify(itemRef));
    expect(bodyOf(item.delete, 200)).toContain("BaseResultDto");
  });

  it("DTO와 path 파라미터를 문서화함", () => {
    const schemas = document.components?.schemas as Record<
      string,
      { properties: Record<string, unknown>; required: string[] }
    >;

    expect(schemas.AdminInterestDto.required).toEqual([
      "pk",
      "name",
      "sort_order",
    ]);
    expect(schemas.AdminInterestNameRequestDto.properties.name).toMatchObject({
      type: "string",
      maxLength: 50,
    });
    expect(schemas.ReorderAdminInterestRequestDto.required).toEqual(["pks"]);
    expect(document.paths[`${BASE}/{pk}`].patch?.parameters).toEqual([
      expect.objectContaining({
        name: "pk",
        in: "path",
        schema: { type: "number" },
      }),
    ]);
  });
});
