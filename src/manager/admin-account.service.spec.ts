import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { AdminAccountRepository } from "@src/database/repository/admin-account.repository";
import { AdminAccountService } from "@src/manager/admin-account.service";
import { ManagerContext } from "@src/manager/context/manager-context";

const NOW = new Date("2026-10-31T00:00:00Z");
const row = (pk: string, role: "admin" | "superadmin" = "admin") => ({
  pk,
  email: `${pk}@gm.gist.ac.kr`,
  role,
  createdAt: NOW,
  updatedAt: NOW,
});

describe("AdminAccountService", () => {
  const repository = {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    insertIfAbsent: jest.fn(),
    updateRole: jest.fn(),
    deleteAdminByPk: jest.fn(),
  };
  const service = new AdminAccountService(
    repository as unknown as AdminAccountRepository,
  );
  const me = new ManagerContext("me", "me@gm.gist.ac.kr", "superadmin");

  beforeEach(() => jest.resetAllMocks());

  describe("create", () => {
    it("이메일을 정규화하고 role 기본값은 admin", async () => {
      repository.insertIfAbsent.mockResolvedValue(row("new"));

      await expect(
        service.create({ email: "New@GM.gist.ac.kr" }),
      ).resolves.toEqual({
        pk: "new",
        email: "new@gm.gist.ac.kr",
        role: "admin",
        created_at: NOW,
        updated_at: NOW,
      });
      expect(repository.insertIfAbsent).toHaveBeenCalledWith({
        email: "new@gm.gist.ac.kr",
        role: "admin",
      });
    });

    it("다른 도메인은 400", async () => {
      await expect(service.create({ email: "a@gmail.com" })).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.insertIfAbsent).not.toHaveBeenCalled();
    });

    it("이미 있으면 409", async () => {
      repository.insertIfAbsent.mockResolvedValue(null);
      await expect(
        service.create({ email: "a@gm.gist.ac.kr" }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("updateRole", () => {
    it("없는 계정은 404", async () => {
      repository.findByPk.mockResolvedValue(null);
      await expect(
        service.updateRole("x", { role: "admin" }, me),
      ).rejects.toThrow(NotFoundException);
    });

    it("자기 자신은 403", async () => {
      repository.findByPk.mockResolvedValue(row("me", "superadmin"));
      await expect(
        service.updateRole("me", { role: "admin" }, me),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.updateRole).not.toHaveBeenCalled();
    });

    it("그 사이 삭제됐으면 404", async () => {
      repository.findByPk.mockResolvedValue(row("x"));
      repository.updateRole.mockResolvedValue(null);
      await expect(
        service.updateRole("x", { role: "superadmin" }, me),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("remove", () => {
    it("admin은 삭제", async () => {
      repository.findByPk.mockResolvedValue(row("x"));
      repository.deleteAdminByPk.mockResolvedValue(true);
      await expect(service.remove("x", me)).resolves.toBeUndefined();
    });

    it("없는 계정은 404", async () => {
      repository.findByPk.mockResolvedValue(null);
      await expect(service.remove("x", me)).rejects.toThrow(NotFoundException);
    });

    it("자기 자신은 403", async () => {
      repository.findByPk.mockResolvedValue(row("me", "superadmin"));
      await expect(service.remove("me", me)).rejects.toThrow(
        new ForbiddenException("You cannot remove yourself."),
      );
    });

    it("superadmin은 403", async () => {
      repository.findByPk.mockResolvedValue(row("x", "superadmin"));
      await expect(service.remove("x", me)).rejects.toThrow(ForbiddenException);
      expect(repository.deleteAdminByPk).not.toHaveBeenCalled();
    });

    it("확인 후 승격돼 지운 행이 없으면 403", async () => {
      repository.findByPk.mockResolvedValue(row("x"));
      repository.deleteAdminByPk.mockResolvedValue(false);
      await expect(service.remove("x", me)).rejects.toThrow(ForbiddenException);
    });
  });
});
