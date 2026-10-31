import { Logger } from "@nestjs/common";
import { DatabaseService } from "@src/database/database.service";
import { HealthService } from "./health.service";

describe("HealthService", () => {
  const ping = jest.fn();
  let service: HealthService;
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    log = jest.spyOn(Logger.prototype, "log").mockImplementation();
    service = new HealthService({ ping } as unknown as DatabaseService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("is ready when the database answers within the probe timeout", async () => {
    ping.mockResolvedValue(undefined);

    await expect(service.isReady()).resolves.toBe(true);

    expect(ping).toHaveBeenCalledWith(2000);
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("is not ready when the ping fails", async () => {
    ping.mockRejectedValue(new Error("connect ECONNREFUSED"));

    await expect(service.isReady()).resolves.toBe(false);

    expect(warn).toHaveBeenCalledWith(
      "Readiness check failed: connect ECONNREFUSED",
    );
  });

  it("logs only when the state changes", async () => {
    ping.mockRejectedValue(new Error("down"));
    await service.isReady();
    await service.isReady();
    await service.isReady();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();

    ping.mockResolvedValue(undefined);
    await expect(service.isReady()).resolves.toBe(true);
    await service.isReady();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("Readiness check recovered");

    ping.mockRejectedValue(new Error("down again"));
    await service.isReady();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
