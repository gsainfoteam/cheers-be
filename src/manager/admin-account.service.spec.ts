import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { AdminAccountRepository } from "@src/admin-repository/admin-account.repository";
import { AdminAuditLogRepository } from "@src/admin-repository/admin-audit-log.repository";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
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
  const tx = {} as TxType;
  const dbService = {
    db: { transaction: (fn: (tx: TxType) => unknown) => fn(tx) },
  };
  const auditLogRepository = { insert: jest.fn() };
  const repository = {
    findAll: jest.fn(),
    findByPkForUpdate: jest.fn(),
    insertIfAbsent: jest.fn(),
    updateRole: jest.fn(),
    deleteAdminByPk: jest.fn(),
  };
  const service = new AdminAccountService(
    dbService as unknown as DatabaseService,
    repository as unknown as AdminAccountRepository,
    auditLogRepository as unknown as AdminAuditLogRepository,
  );
  const me = new ManagerContext("me", "me@gm.gist.ac.kr", "superadmin");

  beforeEach(() => jest.resetAllMocks());

  describe("create", () => {
    it("이메일을 정규화하고 role 기본값은 admin", async () => {
      repository.insertIfAbsent.mockResolvedValue(row("new"));

      await expect(
        service.create({ email: "New@GM.gist.ac.kr" }, me),
      ).resolves.toEqual({
        pk: "new",
        email: "new@gm.gist.ac.kr",
        role: "admin",
        created_at: NOW,
        updated_at: NOW,
      });
      expect(repository.insertIfAbsent).toHaveBeenCalledWith(
        { email: "new@gm.gist.ac.kr", role: "admin" },
        tx,
      );
      expect(auditLogRepository.insert).toHaveBeenCalledWith(
        {
          adminEmail: "me@gm.gist.ac.kr",
          action: "admin_account.create",
          targetType: "admin_account",
          targetId: "new",
          after: { email: "new@gm.gist.ac.kr", role: "admin" },
        },
        tx,
      );
    });

    it("감사 로그 저장이 실패하면 등록도 실패", async () => {
      repository.insertIfAbsent.mockResolvedValue(row("new"));
      auditLogRepository.insert.mockRejectedValue(new Error("db down"));

      await expect(
        service.create({ email: "new@gm.gist.ac.kr" }, me),
      ).rejects.toThrow("db down");
    });

    it("다른 도메인은 400", async () => {
      await expect(
        service.create({ email: "a@gmail.com" }, me),
      ).rejects.toThrow(BadRequestException);
      expect(repository.insertIfAbsent).not.toHaveBeenCalled();
    });

    it("이미 있으면 409", async () => {
      repository.insertIfAbsent.mockResolvedValue(null);
      await expect(
        service.create({ email: "a@gm.gist.ac.kr" }, me),
      ).rejects.toThrow(ConflictException);
      expect(auditLogRepository.insert).not.toHaveBeenCalled();
    });
  });

  describe("updateRole", () => {
    it("없는 계정은 404", async () => {
      repository.findByPkForUpdate.mockResolvedValue(null);
      await expect(
        service.updateRole("x", { role: "admin" }, me),
      ).rejects.toThrow(NotFoundException);
    });

    it("자기 자신은 403", async () => {
      repository.findByPkForUpdate.mockResolvedValue(row("me", "superadmin"));
      await expect(
        service.updateRole("me", { role: "admin" }, me),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.updateRole).not.toHaveBeenCalled();
    });

    it("그 사이 삭제됐으면 404", async () => {
      repository.findByPkForUpdate.mockResolvedValue(row("x"));
      repository.updateRole.mockResolvedValue(null);
      await expect(
        service.updateRole("x", { role: "superadmin" }, me),
      ).rejects.toThrow(NotFoundException);
      expect(auditLogRepository.insert).not.toHaveBeenCalled();
    });

    it("변경 전 · 후 값을 감사 로그로 남김", async () => {
      repository.findByPkForUpdate.mockResolvedValue(row("x"));
      repository.updateRole.mockResolvedValue(row("x", "superadmin"));

      await service.updateRole("x", { role: "superadmin" }, me);

      expect(repository.updateRole).toHaveBeenCalledWith("x", "superadmin", tx);
      expect(auditLogRepository.insert).toHaveBeenCalledWith(
        {
          adminEmail: "me@gm.gist.ac.kr",
          action: "admin_account.role_update",
          targetType: "admin_account",
          targetId: "x",
          before: { email: "x@gm.gist.ac.kr", role: "admin" },
          after: { email: "x@gm.gist.ac.kr", role: "superadmin" },
        },
        tx,
      );
    });
  });

  describe("remove", () => {
    it("admin은 삭제", async () => {
      repository.findByPkForUpdate.mockResolvedValue(row("x"));
      repository.deleteAdminByPk.mockResolvedValue(true);
      await expect(service.remove("x", me)).resolves.toBeUndefined();
      expect(auditLogRepository.insert).toHaveBeenCalledWith(
        {
          adminEmail: "me@gm.gist.ac.kr",
          action: "admin_account.delete",
          targetType: "admin_account",
          targetId: "x",
          before: { email: "x@gm.gist.ac.kr", role: "admin" },
        },
        tx,
      );
    });

    it("없는 계정은 404", async () => {
      repository.findByPkForUpdate.mockResolvedValue(null);
      await expect(service.remove("x", me)).rejects.toThrow(NotFoundException);
    });

    it("자기 자신은 403", async () => {
      repository.findByPkForUpdate.mockResolvedValue(row("me", "superadmin"));
      await expect(service.remove("me", me)).rejects.toThrow(
        new ForbiddenException("You cannot remove yourself."),
      );
    });

    it("superadmin은 403", async () => {
      repository.findByPkForUpdate.mockResolvedValue(row("x", "superadmin"));
      await expect(service.remove("x", me)).rejects.toThrow(ForbiddenException);
      expect(repository.deleteAdminByPk).not.toHaveBeenCalled();
    });

    it("확인 후 승격돼 지운 행이 없으면 403", async () => {
      repository.findByPkForUpdate.mockResolvedValue(row("x"));
      repository.deleteAdminByPk.mockResolvedValue(false);
      await expect(service.remove("x", me)).rejects.toThrow(ForbiddenException);
      expect(auditLogRepository.insert).not.toHaveBeenCalled();
    });
  });
});
