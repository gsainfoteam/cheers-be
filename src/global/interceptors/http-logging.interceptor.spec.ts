import { CallHandler, ExecutionContext, Logger } from "@nestjs/common";
import { lastValueFrom, of } from "rxjs";
import { HttpLoggingInterceptor } from "./http-logging.interceptor";

describe("HttpLoggingInterceptor", () => {
  const interceptor = new HttpLoggingInterceptor();
  const next: CallHandler = { handle: () => of("result") };
  let log: jest.SpyInstance;

  const contextFor = (url: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          method: "GET",
          url,
          headers: {},
          query: {},
          ip: "127.0.0.1",
        }),
        getResponse: () => ({ statusCode: 200 }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, "log").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(["/health", "/health/ready", "/health/ready?a=1"])(
    "does not log %s",
    async (url) => {
      const result = interceptor.intercept(contextFor(url), next);

      await expect(lastValueFrom(result)).resolves.toBe("result");
      expect(log).not.toHaveBeenCalled();
    },
  );

  it("logs the request and response of other paths", async () => {
    const result = interceptor.intercept(contextFor("/api/v1/user/info"), next);

    await expect(lastValueFrom(result)).resolves.toBe("result");
    expect(log).toHaveBeenCalledTimes(2);
  });
});
