import { ConflictException, NotFoundException } from "@nestjs/common";
import { AdminConsentRepository } from "@src/admin-repository/admin-consent.repository";
import { ManagerConsentService } from "@src/manager/consent/manager-consent.service";

const NOW = new Date("2026-10-31T00:00:00Z");
const row = (type: string, version: string, isLatest = false) => ({
  type,
  version,
  isRequired: true,
  url: `https://terms.example.com/${type}/${version}`,
  createdAt: NOW,
  isLatest,
});

describe("ManagerConsentService", () => {
  const repository = {
    findAllVersions: jest.fn(),
    exists: jest.fn(),
    insertIfAbsent: jest.fn(),
    countStatus: jest.fn(),
  };
  const service = new ManagerConsentService(
    repository as unknown as AdminConsentRepository,
  );

  beforeEach(() => jest.resetAllMocks());

  describe("list", () => {
    it("type별로 묶고 레포지토리가 준 순서를 유지", async () => {
      repository.findAllVersions.mockResolvedValue([
        row("privacy", "2", true),
        row("privacy", "1"),
        row("tos", "1", true),
      ]);

      const result = await service.list();

      expect(result.map((t) => t.type)).toEqual(["privacy", "tos"]);
      expect(result[0].versions.map((v) => v.version)).toEqual(["2", "1"]);
      expect(result[0].versions[0]).toEqual({
        type: "privacy",
        version: "2",
        is_required: true,
        url: "https://terms.example.com/privacy/2",
        created_at: NOW,
        is_latest: true,
      });
      expect(result[0].versions[1].is_latest).toBe(false);
    });

    it("약관이 없으면 빈 배열", async () => {
      repository.findAllVersions.mockResolvedValue([]);
      await expect(service.list()).resolves.toEqual([]);
    });
  });

  describe("create", () => {
    const req = {
      type: "tos",
      version: "2",
      is_required: false,
      url: "https://terms.example.com/tos/2",
    };

    it("요청을 행으로 바꿔 넣고 넣은 행을 응답", async () => {
      repository.insertIfAbsent.mockResolvedValue({
        type: "tos",
        version: "2",
        isRequired: false,
        url: req.url,
        createdAt: NOW,
      });

      await expect(service.create(req)).resolves.toEqual({
        type: "tos",
        version: "2",
        is_required: false,
        url: req.url,
        created_at: NOW,
      });
      expect(repository.insertIfAbsent).toHaveBeenCalledWith({
        type: "tos",
        version: "2",
        isRequired: false,
        url: req.url,
      });
    });

    it("이미 있는 버전은 409", async () => {
      repository.insertIfAbsent.mockResolvedValue(null);
      await expect(service.create(req)).rejects.toThrow(ConflictException);
    });
  });

  describe("getStatus", () => {
    it("집계를 응답 필드로 옮김", async () => {
      repository.exists.mockResolvedValue(true);
      repository.countStatus.mockResolvedValue({
        agreed: 3,
        revoked: 2,
        withdrawn: 1,
      });

      await expect(service.getStatus("tos", "2")).resolves.toEqual({
        type: "tos",
        version: "2",
        agreed_count: 3,
        revoked_count: 2,
        withdrawn_count: 1,
      });
      expect(repository.countStatus).toHaveBeenCalledWith("tos", "2");
    });

    it("없는 버전은 404이고 집계하지 않음", async () => {
      repository.exists.mockResolvedValue(false);
      await expect(service.getStatus("tos", "9")).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.countStatus).not.toHaveBeenCalled();
    });
  });
});
