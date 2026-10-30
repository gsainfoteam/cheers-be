import { AuthService } from "@src/auth/auth.service";
import { DatabaseService } from "@src/database/database.service";
import { CoffeeChatContactRepository } from "@src/database/repository/coffee-chat-contact.repository";
import { RefreshTokenRepository } from "@src/database/repository/refresh-token.repository";
import { StudentEmailSendLogRepository } from "@src/database/repository/student-email-send-log.repository";
import { StudentEmailVerificationRepository } from "@src/database/repository/student-email-verification.repository";
import { UserConsentRepository } from "@src/database/repository/user-consent.repository";
import { UserOauthAccountRepository } from "@src/database/repository/user-oauth-account.repository";
import {
  UserRepository,
  UserRow,
} from "@src/database/repository/user.repository";
import { FileService } from "@src/file/file.service";
import { TxType } from "@src/global/types/tx.types";
import { CleanupService } from "./cleanup.service";
import { UserService } from "./user.service";

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date("2026-10-31T00:00:00Z");

const userRow = (pk: string): UserRow => ({
  pk,
  isDeleted: false,
  status: "pending",
  type: "student",
  createdAt: new Date(NOW.getTime() - 48 * HOUR_MS),
  updatedAt: new Date(),
  lastActiveAt: new Date(NOW.getTime() - 48 * HOUR_MS),
  name: null,
  email: null,
  withdrawRequestedAt: null,
});

describe("CleanupService", () => {
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
    db: { transaction: jest.fn((fn: (tx: TxType) => unknown) => fn(tx)) },
  };
  const authService = { revokeAllTokens: jest.fn() };
  const fileService = { deleteFileQuietly: jest.fn() };
  const userService = { deleteStudent: jest.fn(), deleteGraduated: jest.fn() };
  const userRepository = {
    findIncompleteSignupPks: jest.fn(),
    lockIncompleteSignup: jest.fn(),
    deleteByPk: jest.fn(),
  };
  const userOauthAccountRepository = { deleteByUserPk: jest.fn() };
  const userConsentRepository = { deleteByUserPk: jest.fn() };
  const coffeeChatContactRepository = { deleteByUserPk: jest.fn() };
  const studentEmailSendLogRepository = {
    deleteByUserPk: jest.fn(),
    deleteOlderThan: jest.fn(),
  };
  const studentEmailVerificationRepository = { deleteExpired: jest.fn() };
  const refreshTokenRepository = { deleteExpired: jest.fn() };

  const service = new CleanupService(
    dbService as unknown as DatabaseService,
    authService as unknown as AuthService,
    fileService as unknown as FileService,
    userService as unknown as UserService,
    userRepository as unknown as UserRepository,
    userOauthAccountRepository as unknown as UserOauthAccountRepository,
    userConsentRepository as unknown as UserConsentRepository,
    coffeeChatContactRepository as unknown as CoffeeChatContactRepository,
    studentEmailSendLogRepository as unknown as StudentEmailSendLogRepository,
    studentEmailVerificationRepository as unknown as StudentEmailVerificationRepository,
    refreshTokenRepository as unknown as RefreshTokenRepository,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    dbService.db.transaction.mockImplementation((fn: (tx: TxType) => unknown) =>
      fn(tx),
    );
    calls = [];
  });

  describe("purgeIncompleteSignups", () => {
    it("does nothing when there is no target", async () => {
      userRepository.findIncompleteSignupPks.mockResolvedValue([]);

      await expect(service.purgeIncompleteSignups(NOW)).resolves.toBe(0);
      expect(userRepository.lockIncompleteSignup).not.toHaveBeenCalled();
    });

    it("queries with a 24 hour cutoff", async () => {
      userRepository.findIncompleteSignupPks.mockResolvedValue([]);

      await service.purgeIncompleteSignups(NOW);

      expect(userRepository.findIncompleteSignupPks).toHaveBeenCalledWith(
        new Date(NOW.getTime() - 24 * HOUR_MS),
        100,
        [],
      );
    });

    it("deletes children before the user row and removes S3 files only after commit", async () => {
      userRepository.findIncompleteSignupPks
        .mockResolvedValueOnce(["u1"])
        .mockResolvedValueOnce([]);
      userRepository.lockIncompleteSignup.mockImplementation(
        record("users.lock", userRow("u1")),
      );
      authService.revokeAllTokens.mockImplementation(record("refresh_token"));
      userOauthAccountRepository.deleteByUserPk.mockImplementation(
        record("oauth"),
      );
      userConsentRepository.deleteByUserPk.mockImplementation(
        record("consent"),
      );
      coffeeChatContactRepository.deleteByUserPk.mockImplementation(
        record("contact"),
      );
      studentEmailSendLogRepository.deleteByUserPk.mockImplementation(
        record("send_log"),
      );
      userService.deleteStudent.mockImplementation(record("student"));
      userService.deleteGraduated.mockImplementation(
        record("graduated", "business-card/u1/x.png"),
      );
      userRepository.deleteByPk.mockImplementation(record("users.delete"));
      fileService.deleteFileQuietly.mockImplementation((key: string) => {
        calls.push(`s3:${key}`);
        return Promise.resolve();
      });

      await expect(service.purgeIncompleteSignups(NOW)).resolves.toBe(1);

      expect(calls).toEqual([
        "users.lock",
        "refresh_token",
        "oauth",
        "consent",
        "contact",
        "send_log",
        "student",
        "graduated",
        "users.delete",
        "s3:business-card/u1/x.png",
      ]);
    });

    it("skips a user that is locked or no longer pending", async () => {
      userRepository.findIncompleteSignupPks
        .mockResolvedValueOnce(["u1"])
        .mockResolvedValueOnce([]);
      userRepository.lockIncompleteSignup.mockResolvedValue(null);

      await expect(service.purgeIncompleteSignups(NOW)).resolves.toBe(0);
      expect(userRepository.deleteByPk).not.toHaveBeenCalled();
      expect(fileService.deleteFileQuietly).not.toHaveBeenCalled();
      expect(userRepository.findIncompleteSignupPks).toHaveBeenLastCalledWith(
        expect.any(Date),
        100,
        ["u1"],
      );
    });

    it("keeps going after a failure, does not retry the failed user and does not list deleted users", async () => {
      userRepository.findIncompleteSignupPks
        .mockResolvedValueOnce(["u1", "u2"])
        .mockResolvedValueOnce([]);
      userRepository.lockIncompleteSignup.mockImplementation((pk: string) =>
        Promise.resolve(userRow(pk)),
      );
      userService.deleteGraduated.mockResolvedValue(null);
      userRepository.deleteByPk.mockImplementation((pk: string) =>
        pk === "u1" ? Promise.reject(new Error("fk")) : Promise.resolve(),
      );

      await expect(service.purgeIncompleteSignups(NOW)).resolves.toBe(1);
      expect(userRepository.findIncompleteSignupPks).toHaveBeenLastCalledWith(
        expect.any(Date),
        100,
        ["u1"],
      );
    });

    it("does not delete S3 files when the transaction fails", async () => {
      userRepository.findIncompleteSignupPks
        .mockResolvedValueOnce(["u1"])
        .mockResolvedValueOnce([]);
      userRepository.lockIncompleteSignup.mockResolvedValue(userRow("u1"));
      userService.deleteGraduated.mockResolvedValue("card.png");
      userRepository.deleteByPk.mockRejectedValue(new Error("fk"));

      await expect(service.purgeIncompleteSignups(NOW)).resolves.toBe(0);
      expect(fileService.deleteFileQuietly).not.toHaveBeenCalled();
    });
  });

  describe("purgeExpiredData", () => {
    it("deletes expired verifications, send logs older than 48 hours and expired refresh tokens", async () => {
      studentEmailVerificationRepository.deleteExpired.mockResolvedValue(2);
      studentEmailSendLogRepository.deleteOlderThan.mockResolvedValue(3);
      refreshTokenRepository.deleteExpired.mockResolvedValue(4);

      await expect(service.purgeExpiredData(NOW)).resolves.toEqual({
        verifications: 2,
        sendLogs: 3,
        refreshTokens: 4,
      });
      expect(
        studentEmailVerificationRepository.deleteExpired,
      ).toHaveBeenCalledWith(NOW, tx);
      expect(
        studentEmailSendLogRepository.deleteOlderThan,
      ).toHaveBeenCalledWith(new Date(NOW.getTime() - 48 * HOUR_MS), tx);
    });

    it("runs the others when one fails", async () => {
      studentEmailVerificationRepository.deleteExpired.mockRejectedValue(
        new Error("db"),
      );
      studentEmailSendLogRepository.deleteOlderThan.mockResolvedValue(3);
      refreshTokenRepository.deleteExpired.mockResolvedValue(4);

      await expect(service.purgeExpiredData(NOW)).resolves.toEqual({
        verifications: 0,
        sendLogs: 3,
        refreshTokens: 4,
      });
    });
  });
});
