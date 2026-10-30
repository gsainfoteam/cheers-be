import { QueryLogWriter } from "@src/database/query.log.writer";
import { LoggerService } from "@src/global/logger/logger.service";

describe("QueryLogWriter", () => {
  const loggerService = { queryLog: jest.fn() };
  const writer = new QueryLogWriter(loggerService as unknown as LoggerService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("logs ordinary queries as they are", () => {
    const message = 'Query: select * from "users" -- params: ["a"]';

    writer.write(message);

    expect(loggerService.queryLog).toHaveBeenCalledWith(message);
  });

  it("does not log parameters of signing key queries", () => {
    writer.write(
      'Query: insert into "jwt_signing_key" -- params: ["secret-private-key"]',
    );

    expect(loggerService.queryLog).toHaveBeenCalledTimes(1);
    expect(loggerService.queryLog.mock.calls[0][0]).not.toContain(
      "secret-private-key",
    );
  });
});
