import { NotFoundException } from "@nestjs/common";
import { AdminAccessLogRepository } from "@src/admin-repository/admin-access-log.repository";
import { AdminAuditLogRepository } from "@src/admin-repository/admin-audit-log.repository";
import { AdminDevUserRepository } from "@src/admin-repository/admin-dev-user.repository";
import { DatabaseService } from "@src/database/database.service";
import { FileService } from "@src/file/file.service";
import { TxType } from "@src/global/types/tx.types";
import { ManagerContext } from "@src/manager/context/manager-context";
import { DevUserService } from "./dev-user.service";

const USER_PK = "8f1d2c3b-0000-4000-8000-000000000001";
const NOW = new Date("2026-11-03T00:00:00Z");

describe("DevUserService", () => {
  const tx = {} as TxType;
  // 커밋 시점을 기록해 파일 삭제가 커밋 뒤에 일어나는지 확인
  const events: string[] = [];
  const dbService = {
    db: {
      transaction: async (fn: (tx: TxType) => unknown) => {
        const result = await fn(tx);
        events.push("commit");
        return result;
      },
    },
  };
  const fileService = { deleteFileQuietly: jest.fn() };
  const adminDevUserRepository = { findPage: jest.fn(), hardDelete: jest.fn() };
  const adminAccessLogRepository = { insert: jest.fn() };
  const adminAuditLogRepository = { insert: jest.fn() };
  const hardDeleted = (fileKeys: string[]) => ({
    user: {
      pk: USER_PK,
      type: "student",
      status: "active",
      isDeleted: false,
      withdrawRequestedAt: null,
      name: "김재학",
      email: "student@gm.gist.ac.kr",
      createdAt: new Date("2026-10-01T00:00:00Z"),
    },
    studentPks: ["s1"],
    graduatedPks: [],
    fileKeys,
  });
  const service = new DevUserService(
    dbService as unknown as DatabaseService,
    fileService as unknown as FileService,
    adminDevUserRepository as unknown as AdminDevUserRepository,
    adminAccessLogRepository as unknown as AdminAccessLogRepository,
    adminAuditLogRepository as unknown as AdminAuditLogRepository,
  );
  const manager = new ManagerContext("me", "me@gm.gist.ac.kr", "superadmin");

  beforeEach(() => {
    jest.resetAllMocks();
    events.length = 0;
  });

  describe("list", () => {
    const row = {
      pk: USER_PK,
      type: "student",
      status: "active",
      isDeleted: false,
      withdrawRequestedAt: null,
      name: "김재학",
      email: "s@gmail.com",
      createdAt: NOW,
    };

    it("페이지를 offset으로 바꾸고 행을 DTO로 변환", async () => {
      adminDevUserRepository.findPage.mockResolvedValue({
        rows: [row],
        total: 21,
      });

      await expect(service.list({ page: 2, size: 20 })).resolves.toEqual({
        items: [
          {
            user_pk: USER_PK,
            type: "student",
            status: "active",
            name: "김재학",
            email: "s@gmail.com",
            created_at: NOW,
          },
        ],
        page: 2,
        size: 20,
        total: 21,
      });
      expect(adminDevUserRepository.findPage).toHaveBeenCalledWith(20, 20);
    });

    it.each([
      [{ status: "pending" }, "pending"],
      [{ withdrawRequestedAt: NOW }, "withdrawal_requested"],
      // 탈퇴 처리가 끝나면 withdraw_requested_at이 남아 있어도 withdrawn
      [{ isDeleted: true, withdrawRequestedAt: NOW }, "withdrawn"],
    ])("상태 %o → %s", async (patch, status) => {
      adminDevUserRepository.findPage.mockResolvedValue({
        rows: [{ ...row, ...patch }],
        total: 1,
      });

      const result = await service.list({ page: 1, size: 20 });

      expect(result.items[0].status).toBe(status);
    });
  });

  describe("delete", () => {
    it("한 트랜잭션에서 지우고 기록한 뒤, 커밋 뒤에 파일을 지움", async () => {
      adminDevUserRepository.hardDelete.mockImplementation(async () => {
        events.push("hardDelete");
        return hardDeleted(["business-card/a.jpg", "attachment/b.pdf"]);
      });
      adminAccessLogRepository.insert.mockImplementation(async () => {
        events.push("accessLog");
      });
      fileService.deleteFileQuietly.mockImplementation(async (key: string) => {
        events.push(`deleteFile:${key}`);
      });

      await service.delete(USER_PK, manager);

      expect(adminDevUserRepository.hardDelete).toHaveBeenCalledWith(
        USER_PK,
        tx,
      );
      expect(adminAccessLogRepository.insert).toHaveBeenCalledWith(
        {
          adminEmail: "me@gm.gist.ac.kr",
          targetType: "dev_user_hard_delete",
          targetId: USER_PK,
        },
        tx,
      );
      expect(adminAuditLogRepository.insert).toHaveBeenCalledWith(
        {
          adminEmail: "me@gm.gist.ac.kr",
          action: "dev_user.hard_delete",
          targetType: "user",
          targetId: USER_PK,
          before: {
            type: "student",
            status: "active",
            is_deleted: false,
            withdraw_requested_at: null,
            name: "김재학",
            email: "student@gm.gist.ac.kr",
            created_at: new Date("2026-10-01T00:00:00Z"),
            student_pks: ["s1"],
            graduated_pks: [],
          },
        },
        tx,
      );
      expect(events).toEqual([
        "hardDelete",
        "accessLog",
        "commit",
        "deleteFile:business-card/a.jpg",
        "deleteFile:attachment/b.pdf",
      ]);
    });

    it("없는 유저면 404, 기록 · 파일 삭제 없음", async () => {
      adminDevUserRepository.hardDelete.mockResolvedValue(null);

      await expect(service.delete(USER_PK, manager)).rejects.toThrow(
        new NotFoundException("User not found"),
      );
      expect(adminAccessLogRepository.insert).not.toHaveBeenCalled();
      expect(adminAuditLogRepository.insert).not.toHaveBeenCalled();
      expect(fileService.deleteFileQuietly).not.toHaveBeenCalled();
    });

    it("기록 저장이 실패하면 예외가 올라가고 파일을 지우지 않음 (삭제도 rollback)", async () => {
      adminDevUserRepository.hardDelete.mockResolvedValue(hardDeleted(["a"]));
      adminAccessLogRepository.insert.mockRejectedValue(new Error("db down"));

      await expect(service.delete(USER_PK, manager)).rejects.toThrow("db down");
      expect(events).not.toContain("commit");
      expect(fileService.deleteFileQuietly).not.toHaveBeenCalled();
    });

    it("감사 로그 저장이 실패해도 예외가 올라가고 파일을 지우지 않음 (삭제도 rollback)", async () => {
      adminDevUserRepository.hardDelete.mockResolvedValue(hardDeleted(["a"]));
      adminAuditLogRepository.insert.mockRejectedValue(new Error("db down"));

      await expect(service.delete(USER_PK, manager)).rejects.toThrow("db down");
      expect(events).not.toContain("commit");
      expect(fileService.deleteFileQuietly).not.toHaveBeenCalled();
    });
  });
});
