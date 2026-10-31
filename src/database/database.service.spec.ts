import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";
import { DatabaseService } from "@src/database/database.service";
import { LoggerService } from "@src/global/logger/logger.service";

describe("DatabaseService", () => {
  // 연결하지 않음: new Pool은 첫 쿼리 전까지 연결을 만들지 않고, query는 대체함
  let service: DatabaseService;
  let query: jest.SpyInstance;

  beforeEach(() => {
    query = jest.spyOn(Pool.prototype, "query");
    service = new DatabaseService(
      {
        get: () => "postgresql://u:p@127.0.0.1:9/db",
      } as unknown as ConfigService,
      {} as LoggerService,
    );
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await service.onModuleDestroy();
  });

  describe("ping", () => {
    it("runs SELECT 1 with a query timeout", async () => {
      query.mockImplementation(async () => ({ rows: [] }));

      await expect(service.ping(50)).resolves.toBeUndefined();

      expect(query).toHaveBeenCalledWith({
        text: "SELECT 1",
        query_timeout: 50,
      });
    });

    it("rejects when the query fails", async () => {
      query.mockImplementation(async () => {
        throw new Error("connect ECONNREFUSED");
      });

      await expect(service.ping(50)).rejects.toThrow("connect ECONNREFUSED");
    });

    // pool이 꽉 차면 query_timeout이 시작되지 않아 쿼리가 끝나지 않음
    it("rejects when the query never settles", async () => {
      query.mockImplementation(() => new Promise(() => undefined));

      await expect(service.ping(10)).rejects.toThrow(
        "Database ping timed out (10ms)",
      );
    });
  });

  it("keeps the process alive and logs when an idle connection fails", () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    const pool = (service as unknown as { pool: Pool }).pool;

    expect(() => pool.emit("error", new Error("terminated"))).not.toThrow();

    expect(warn).toHaveBeenCalledWith(
      "Idle database connection error: terminated",
    );
  });
});
