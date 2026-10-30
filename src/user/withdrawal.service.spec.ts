import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthService } from "@src/auth/auth.service";
import { UserContext } from "@src/auth/context/user-context";
import { DatabaseService } from "@src/database/database.service";
import { CoffeeChatContactRepository } from "@src/database/repository/coffee-chat-contact.repository";
import { GraduatedRepository } from "@src/database/repository/graduated.repository";
import { StudentEmailSendLogRepository } from "@src/database/repository/student-email-send-log.repository";
import { StudentEmailVerificationRepository } from "@src/database/repository/student-email-verification.repository";
import { StudentProfileAttachmentRepository } from "@src/database/repository/student-profile-attachment.repository";
import { StudentRepository } from "@src/database/repository/student.repository";
import { UserOauthAccountRepository } from "@src/database/repository/user-oauth-account.repository";
import {
  UserRepository,
  UserRow,
} from "@src/database/repository/user.repository";
import { FileService } from "@src/file/file.service";
import { BaseResultDto } from "@src/global/dto/base-result.dto";
import { TxType } from "@src/global/types/tx.types";
import { WithdrawalService } from "./withdrawal.service";

const USER_PK = "8f1d2c3b-0000-4000-8000-000000000001";
const DAY_MS = 24 * 60 * 60 * 1000;

const userRow = (overrides: Partial<UserRow> = {}): UserRow => ({
  pk: USER_PK,
  isDeleted: false,
  status: "active",
  type: "graduated",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastActiveAt: new Date(),
  name: "김철수",
  email: "a@gmail.com",
  withdrawRequestedAt: new Date("2026-09-01T00:00:00Z"),
  ...overrides,
});

describe("WithdrawalService", () => {
  const tx = {} as TxType;
  // 트랜잭션 안에서 호출된 순서를 확인하기 위한 기록
  let calls: string[];
  const record =
    (name: string, value?: unknown) =>
    (..._args: unknown[]) => {
      calls.push(name);
      return Promise.resolve(value);
    };

  const dbService = {
    db: { transaction: (fn: (tx: TxType) => unknown) => fn(tx) },
  };
  const authService = { revokeAllTokens: jest.fn() };
  const fileService = { deleteFileQuietly: jest.fn() };
  const userRepository = {
    findByPkForUpdate: jest.fn(),
    requestWithdrawal: jest.fn(),
    findWithdrawalDuePks: jest.fn(),
    lockWithdrawalDue: jest.fn(),
    withdraw: jest.fn(),
  };
  const userOauthAccountRepository = { deleteByUserPk: jest.fn() };
  const studentRepository = {
    findByUserPk: jest.fn(),
    clearEmailByUserPk: jest.fn(),
  };
  const studentEmailVerificationRepository = { deleteByStudentPk: jest.fn() };
  const studentEmailSendLogRepository = { deleteByUserPk: jest.fn() };
  const studentProfileAttachmentRepository = {
    deleteFilesByStudentPk: jest.fn(),
  };
  const graduatedRepository = {
    findByUserPk: jest.fn(),
    clearBusinessCardKey: jest.fn(),
  };
  const coffeeChatContactRepository = { deleteByUserPk: jest.fn() };

  const createService = (env: Record<string, string | undefined> = {}) =>
    new WithdrawalService(
      { get: (key: string) => env[key] } as unknown as ConfigService,
      dbService as unknown as DatabaseService,
      authService as unknown as AuthService,
      fileService as unknown as FileService,
      userRepository as unknown as UserRepository,
      userOauthAccountRepository as unknown as UserOauthAccountRepository,
      studentRepository as unknown as StudentRepository,
      studentEmailVerificationRepository as unknown as StudentEmailVerificationRepository,
      studentEmailSendLogRepository as unknown as StudentEmailSendLogRepository,
      studentProfileAttachmentRepository as unknown as StudentProfileAttachmentRepository,
      graduatedRepository as unknown as GraduatedRepository,
      coffeeChatContactRepository as unknown as CoffeeChatContactRepository,
    );

  beforeEach(() => {
    jest.resetAllMocks();
    calls = [];
    studentProfileAttachmentRepository.deleteFilesByStudentPk.mockResolvedValue(
      [],
    );
  });

  describe("constructor", () => {
    it.each(["-1", "1.5", "abc"])(
      "rejects WITHDRAWAL_GRACE_DAYS=%s",
      (value) => {
        expect(() => createService({ WITHDRAWAL_GRACE_DAYS: value })).toThrow(
          "WITHDRAWAL_GRACE_DAYS must be a non-negative integer",
        );
      },
    );
  });

  describe("request", () => {
    const ctx = new UserContext(USER_PK, "graduated", "active");

    it("locks the user, starts the grace period and logs out every device without deleting data", async () => {
      userRepository.findByPkForUpdate.mockImplementation(
        record("users.lock", userRow({ withdrawRequestedAt: null })),
      );
      userRepository.requestWithdrawal.mockImplementation(record("request"));
      authService.revokeAllTokens.mockImplementation(record("revokeAll"));

      await expect(createService().request(ctx)).resolves.toBe(
        BaseResultDto.OK,
      );

      expect(calls).toEqual(["users.lock", "request", "revokeAll"]);
      expect(userRepository.requestWithdrawal).toHaveBeenCalledWith(
        USER_PK,
        tx,
      );
      expect(userRepository.withdraw).not.toHaveBeenCalled();
      expect(userOauthAccountRepository.deleteByUserPk).not.toHaveBeenCalled();
      expect(fileService.deleteFileQuietly).not.toHaveBeenCalled();
    });

    it("returns 401 when the user already withdrew or requested withdrawal", async () => {
      userRepository.findByPkForUpdate.mockResolvedValue(null);

      await expect(createService().request(ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(userRepository.requestWithdrawal).not.toHaveBeenCalled();
    });
  });

  describe("purgeExpired", () => {
    const now = new Date("2026-11-01T00:00:00Z");

    // 가입을 마친 유저는 WITHDRAWAL_GRACE_DAYS, 가입 중 탈퇴는 항상 1일
    const cutoffs = (activeDays: number) => ({
      activeRequestedBefore: new Date(now.getTime() - activeDays * DAY_MS),
      pendingRequestedBefore: new Date(now.getTime() - 1 * DAY_MS),
    });

    it("uses WITHDRAWAL_GRACE_DAYS (default 30) for active users and 1 day for pending users", async () => {
      userRepository.findWithdrawalDuePks.mockResolvedValue([]);

      await createService().purgeExpired(now);
      await createService({ WITHDRAWAL_GRACE_DAYS: "7" }).purgeExpired(now);
      await createService({ WITHDRAWAL_GRACE_DAYS: "0" }).purgeExpired(now);
      // 빈 값은 미설정으로 보고 기본값 (0일로 바로 삭제하지 않음)
      await createService({ WITHDRAWAL_GRACE_DAYS: "" }).purgeExpired(now);
      await createService({ WITHDRAWAL_GRACE_DAYS: "  " }).purgeExpired(now);

      expect(userRepository.findWithdrawalDuePks).toHaveBeenNthCalledWith(
        1,
        cutoffs(30),
        100,
        [],
      );
      expect(userRepository.findWithdrawalDuePks).toHaveBeenNthCalledWith(
        2,
        cutoffs(7),
        100,
        [],
      );
      expect(userRepository.findWithdrawalDuePks).toHaveBeenNthCalledWith(
        3,
        cutoffs(0),
        100,
        [],
      );
      for (const nth of [4, 5]) {
        expect(userRepository.findWithdrawalDuePks).toHaveBeenNthCalledWith(
          nth,
          cutoffs(30),
          100,
          [],
        );
      }
    });

    it("removes login methods and personal info of a graduated user, then deletes the business card", async () => {
      userRepository.findWithdrawalDuePks
        .mockResolvedValueOnce([USER_PK])
        .mockResolvedValueOnce([]);
      userRepository.lockWithdrawalDue.mockImplementation(
        record("users.lock", userRow({ type: "graduated" })),
      );
      userOauthAccountRepository.deleteByUserPk.mockImplementation(
        record("oauth.delete"),
      );
      authService.revokeAllTokens.mockImplementation(record("revokeAll"));
      coffeeChatContactRepository.deleteByUserPk.mockImplementation(
        record("contact.delete"),
      );
      graduatedRepository.findByUserPk.mockResolvedValue({
        pk: "graduated-1",
        businessCardKey: "business-card/a.jpg",
      });
      graduatedRepository.clearBusinessCardKey.mockImplementation(
        record("graduated.clearBusinessCardKey"),
      );
      userRepository.withdraw.mockImplementation(record("users.withdraw"));
      fileService.deleteFileQuietly.mockImplementation(record("s3.delete"));

      await expect(createService().purgeExpired(now)).resolves.toBe(1);

      expect(calls).toEqual([
        "users.lock",
        "oauth.delete",
        "revokeAll",
        "contact.delete",
        "graduated.clearBusinessCardKey",
        "users.withdraw",
        "s3.delete",
      ]);
      expect(userRepository.lockWithdrawalDue).toHaveBeenCalledWith(
        USER_PK,
        cutoffs(30),
        tx,
      );
      expect(graduatedRepository.clearBusinessCardKey).toHaveBeenCalledWith(
        "graduated-1",
        tx,
      );
      expect(fileService.deleteFileQuietly).toHaveBeenCalledWith(
        "business-card/a.jpg",
      );
      // 다음 조회에서는 이번 실행에서 시도한 유저를 뺌
      expect(userRepository.findWithdrawalDuePks).toHaveBeenNthCalledWith(
        2,
        cutoffs(30),
        100,
        [USER_PK],
      );
    });

    it("clears the school email of a student, including a pending verification", async () => {
      userRepository.findWithdrawalDuePks
        .mockResolvedValueOnce([USER_PK])
        .mockResolvedValueOnce([]);
      userRepository.lockWithdrawalDue.mockResolvedValue(
        userRow({ type: "student" }),
      );
      studentRepository.findByUserPk.mockResolvedValue({ pk: "student-1" });

      await expect(createService().purgeExpired(now)).resolves.toBe(1);

      expect(
        studentEmailVerificationRepository.deleteByStudentPk,
      ).toHaveBeenCalledWith("student-1", tx);
      expect(studentRepository.clearEmailByUserPk).toHaveBeenCalledWith(
        USER_PK,
        tx,
      );
      expect(graduatedRepository.findByUserPk).not.toHaveBeenCalled();
      expect(userRepository.withdraw).toHaveBeenCalledWith(USER_PK, tx);
      expect(fileService.deleteFileQuietly).not.toHaveBeenCalled();
    });

    it("deletes the attachment rows of a student in the transaction, then the S3 files", async () => {
      userRepository.findWithdrawalDuePks
        .mockResolvedValueOnce([USER_PK])
        .mockResolvedValueOnce([]);
      userRepository.lockWithdrawalDue.mockResolvedValue(
        userRow({ type: "student" }),
      );
      studentRepository.findByUserPk.mockResolvedValue({ pk: "student-1" });
      studentProfileAttachmentRepository.deleteFilesByStudentPk.mockResolvedValue(
        ["attachment/a.pdf", "attachment/b.pdf"],
      );
      const order: string[] = [];
      userRepository.withdraw.mockImplementation(() => {
        order.push("withdraw");
        return Promise.resolve();
      });
      fileService.deleteFileQuietly.mockImplementation((key: string) => {
        order.push(key);
        return Promise.resolve();
      });

      await expect(createService().purgeExpired(now)).resolves.toBe(1);

      expect(
        studentProfileAttachmentRepository.deleteFilesByStudentPk,
      ).toHaveBeenCalledWith("student-1", tx);
      expect(order).toEqual([
        "withdraw",
        "attachment/a.pdf",
        "attachment/b.pdf",
      ]);
    });

    it.each(["student", "graduated"] as const)(
      "deletes the email send log of a %s, who may have switched types",
      async (type) => {
        userRepository.findWithdrawalDuePks
          .mockResolvedValueOnce([USER_PK])
          .mockResolvedValueOnce([]);
        userRepository.lockWithdrawalDue.mockResolvedValue(userRow({ type }));

        await expect(createService().purgeExpired(now)).resolves.toBe(1);

        expect(
          studentEmailSendLogRepository.deleteByUserPk,
        ).toHaveBeenCalledWith(USER_PK, tx);
      },
    );

    it("skips a user locked by another instance or whose withdrawal was just canceled", async () => {
      userRepository.findWithdrawalDuePks
        .mockResolvedValueOnce([USER_PK])
        .mockResolvedValueOnce([]);
      userRepository.lockWithdrawalDue.mockResolvedValue(null);

      await expect(createService().purgeExpired(now)).resolves.toBe(0);

      expect(userOauthAccountRepository.deleteByUserPk).not.toHaveBeenCalled();
      expect(userRepository.withdraw).not.toHaveBeenCalled();
    });

    it("keeps going when one user fails and does not retry it in the same run", async () => {
      const otherPk = "8f1d2c3b-0000-4000-8000-000000000002";
      userRepository.findWithdrawalDuePks
        .mockResolvedValueOnce([USER_PK, otherPk])
        .mockResolvedValueOnce([]);
      userRepository.lockWithdrawalDue
        .mockRejectedValueOnce(new Error("deadlock"))
        .mockResolvedValueOnce(userRow({ pk: otherPk, type: "student" }));

      await expect(createService().purgeExpired(now)).resolves.toBe(1);

      expect(userRepository.withdraw).toHaveBeenCalledWith(otherPk, tx);
      expect(userRepository.findWithdrawalDuePks).toHaveBeenNthCalledWith(
        2,
        cutoffs(30),
        100,
        [USER_PK, otherPk],
      );
    });
  });
});
