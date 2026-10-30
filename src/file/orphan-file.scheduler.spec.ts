import { Logger } from "@nestjs/common";
import { OrphanFileScheduler } from "./orphan-file.scheduler";
import { OrphanFileService } from "./orphan-file.service";

describe("OrphanFileScheduler", () => {
  const orphanFileService = { cleanup: jest.fn() };
  const scheduler = new OrphanFileScheduler(
    orphanFileService as unknown as OrphanFileService,
  );
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it("logs the result", async () => {
    orphanFileService.cleanup.mockResolvedValue({
      scanned: 4,
      orphans: 2,
      deleted: 1,
      failed: 1,
      stopped: false,
    });

    await scheduler.cleanup();

    expect(logSpy).toHaveBeenCalledWith(
      "Orphan files: scanned 4, orphan 2, deleted 1, failed 1, stopped false",
    );
  });

  it("logs an error instead of throwing when the cleanup fails", async () => {
    orphanFileService.cleanup.mockRejectedValue(new Error("S3 down"));

    await expect(scheduler.cleanup()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      "Orphan file cleanup failed: S3 down",
      expect.any(String),
    );
  });
});
