import { DatabaseService } from "@src/database/database.service";
import { createE2eApp, E2eContext } from "./support/app";
import { http } from "./support/flows";

describe("상태 확인 API", () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => ctx.close());

  it("인증 없이 두 경로 모두 200으로 응답함", async () => {
    await http(ctx).get("/health").expect(200, { result: "OK" });
    await http(ctx).get("/health/ready").expect(200, { result: "OK" });
  });

  it("DB에 연결할 수 없으면 readiness만 실패하고 원인을 응답에 넣지 않음", async () => {
    const ping = jest
      .spyOn(ctx.app.get(DatabaseService), "ping")
      .mockRejectedValue(new Error("password authentication failed"));

    await http(ctx).get("/health").expect(200, { result: "OK" });
    await http(ctx)
      .get("/health/ready")
      .expect(503, { statusCode: 503, message: "Service Unavailable" });

    expect(ping).toHaveBeenCalledTimes(1);
    expect(ctx.slack.messages).toEqual([]);

    ping.mockResolvedValue(undefined);
    await http(ctx).get("/health/ready").expect(200, { result: "OK" });
  });
});
