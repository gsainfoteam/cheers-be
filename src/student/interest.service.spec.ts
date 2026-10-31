import { Logger } from "@nestjs/common";
import { InterestRepository } from "@src/database/repository/interest.repository";
import { InterestService } from "./interest.service";

describe("InterestService", () => {
  const interestRepository = { findAllNames: jest.fn() };
  let service: InterestService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InterestService(
      interestRepository as unknown as InterestRepository,
    );
  });

  it("loads the list once on init and serves it from memory", async () => {
    interestRepository.findAllNames.mockResolvedValue(["반도체", "소프트웨어"]);

    await service.onModuleInit();

    expect(service.getNames()).toEqual(["반도체", "소프트웨어"]);
    expect(service.getNames()).toEqual(["반도체", "소프트웨어"]);
    expect(interestRepository.findAllNames).toHaveBeenCalledTimes(1);
  });

  it("does not let callers change the stored list", async () => {
    interestRepository.findAllNames.mockResolvedValue(["반도체"]);
    await service.onModuleInit();

    service.getNames().push("직접입력");

    expect(service.getNames()).toEqual(["반도체"]);
  });

  it("starts with an empty list", async () => {
    interestRepository.findAllNames.mockResolvedValue([]);
    await service.onModuleInit();

    expect(service.getNames()).toEqual([]);
  });

  it("fails startup when the DB read fails", async () => {
    interestRepository.findAllNames.mockRejectedValue(new Error("db down"));

    await expect(service.onModuleInit()).rejects.toThrow("db down");
  });

  describe("refresh", () => {
    let errorSpy: jest.SpyInstance;

    beforeEach(async () => {
      errorSpy = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);
      interestRepository.findAllNames.mockResolvedValue(["반도체"]);
      await service.onModuleInit();
    });

    afterEach(() => errorSpy.mockRestore());

    it("replaces the list with the new DB state", async () => {
      interestRepository.findAllNames.mockResolvedValue(["로보틱스", "반도체"]);

      await service.refresh();

      expect(service.getNames()).toEqual(["로보틱스", "반도체"]);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("keeps the current list and logs when the read fails", async () => {
      interestRepository.findAllNames.mockRejectedValue(new Error("db down"));

      await expect(service.refresh()).resolves.toBeUndefined();

      expect(service.getNames()).toEqual(["반도체"]);
      expect(errorSpy).toHaveBeenCalledWith(
        "Interest cache refresh failed: db down",
        expect.any(String),
      );
    });

    it("recovers on the next refresh after a failure", async () => {
      interestRepository.findAllNames.mockRejectedValueOnce(new Error("down"));
      await service.refresh();

      interestRepository.findAllNames.mockResolvedValue(["로보틱스"]);
      await service.refresh();

      expect(service.getNames()).toEqual(["로보틱스"]);
    });

    it("does not let an older read overwrite a newer one", async () => {
      let resolveOlder!: (names: string[]) => void;
      interestRepository.findAllNames
        .mockReturnValueOnce(
          new Promise<string[]>((resolve) => {
            resolveOlder = resolve;
          }),
        )
        .mockResolvedValueOnce(["커밋 후 목록"]);

      const older = service.refresh();
      await service.refresh();
      resolveOlder(["커밋 전 목록"]);
      await older;

      expect(service.getNames()).toEqual(["커밋 후 목록"]);
    });
  });
});
