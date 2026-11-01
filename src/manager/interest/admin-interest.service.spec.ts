import { ConflictException, NotFoundException } from "@nestjs/common";
import { AdminInterestRepository } from "@src/admin-repository/admin-interest.repository";
import { DatabaseService } from "@src/database/database.service";
import { AdminInterestService } from "@src/manager/interest/admin-interest.service";
import { InterestService } from "@src/student/interest.service";

const row = (pk: number, name: string, sortOrder = pk) => ({
  pk,
  name,
  sortOrder,
});

describe("AdminInterestService", () => {
  const tx = {};
  const repository = {
    lockForWrite: jest.fn(),
    findAll: jest.fn(),
    findByPk: jest.fn(),
    findByName: jest.fn(),
    insert: jest.fn(),
    updateName: jest.fn(),
    updateSortOrder: jest.fn(),
    deleteByPk: jest.fn(),
  };
  const interestService = { refresh: jest.fn() };
  const transaction = jest.fn();
  const service = new AdminInterestService(
    { db: { transaction } } as unknown as DatabaseService,
    repository as unknown as AdminInterestRepository,
    interestService as unknown as InterestService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    transaction.mockImplementation((work: (t: unknown) => unknown) => work(tx));
  });

  describe("create", () => {
    it("잠근 뒤 추가하고, 커밋 후 캐시를 다시 읽음", async () => {
      repository.findByName.mockResolvedValue(null);
      repository.insert.mockResolvedValue(row(13, "우주"));
      const order: string[] = [];
      transaction.mockImplementation(async (work: (t: unknown) => unknown) => {
        const result = await work(tx);
        order.push("commit");
        return result;
      });
      interestService.refresh.mockImplementation(() => {
        order.push("refresh");
      });

      await expect(service.create({ name: "우주" })).resolves.toEqual({
        pk: 13,
        name: "우주",
        sort_order: 13,
      });

      expect(repository.lockForWrite).toHaveBeenCalledWith(tx);
      expect(order).toEqual(["commit", "refresh"]);
    });

    it("같은 이름은 409이고 캐시를 다시 읽지 않음", async () => {
      repository.findByName.mockResolvedValue(row(1, "반도체"));

      await expect(service.create({ name: "반도체" })).rejects.toThrow(
        ConflictException,
      );

      expect(repository.insert).not.toHaveBeenCalled();
      expect(interestService.refresh).not.toHaveBeenCalled();
    });
  });

  describe("updateName", () => {
    it("없는 항목은 404", async () => {
      repository.findByPk.mockResolvedValue(null);

      await expect(service.updateName(9, { name: "우주" })).rejects.toThrow(
        NotFoundException,
      );
      expect(interestService.refresh).not.toHaveBeenCalled();
    });

    it("다른 항목이 쓰는 이름은 409", async () => {
      repository.findByPk.mockResolvedValue(row(1, "반도체"));
      repository.findByName.mockResolvedValue(row(2, "소프트웨어"));

      await expect(
        service.updateName(1, { name: "소프트웨어" }),
      ).rejects.toThrow(ConflictException);
      expect(repository.updateName).not.toHaveBeenCalled();
    });

    it("자기 이름 그대로는 성공", async () => {
      repository.findByPk.mockResolvedValue(row(1, "반도체"));
      repository.findByName.mockResolvedValue(row(1, "반도체"));
      repository.updateName.mockResolvedValue(row(1, "반도체"));

      await expect(
        service.updateName(1, { name: "반도체" }),
      ).resolves.toMatchObject({ pk: 1, name: "반도체" });
      expect(interestService.refresh).toHaveBeenCalledTimes(1);
    });
  });

  describe("remove", () => {
    it("지우면 캐시를 다시 읽음", async () => {
      repository.deleteByPk.mockResolvedValue(true);

      await service.remove(1);

      expect(interestService.refresh).toHaveBeenCalledTimes(1);
    });

    it("지운 행이 없으면 404", async () => {
      repository.deleteByPk.mockResolvedValue(false);

      await expect(service.remove(9)).rejects.toThrow(NotFoundException);
      expect(interestService.refresh).not.toHaveBeenCalled();
    });
  });

  describe("reorder", () => {
    const current = [row(1, "a"), row(2, "b"), row(3, "c")];

    it("보낸 순서대로 1부터 번호를 매김", async () => {
      repository.findAll.mockResolvedValue(current);

      await service.reorder({ pks: [3, 1, 2] });

      expect(repository.updateSortOrder.mock.calls).toEqual([
        [3, 1, tx],
        [1, 2, tx],
        [2, 3, tx],
      ]);
      expect(interestService.refresh).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["빠진 항목", [1, 2]],
      ["없는 항목", [1, 2, 9]],
      ["추가된 항목", [1, 2, 3, 4]],
    ])("%s이 있으면 409", async (_, pks) => {
      repository.findAll.mockResolvedValue(current);

      await expect(service.reorder({ pks })).rejects.toThrow(ConflictException);

      expect(repository.updateSortOrder).not.toHaveBeenCalled();
      expect(interestService.refresh).not.toHaveBeenCalled();
    });
  });
});
