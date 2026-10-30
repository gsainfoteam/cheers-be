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
});
