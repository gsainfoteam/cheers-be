import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac } from "node:crypto";
import { DatabaseService } from "@src/database/database.service";
import { SchoolRepository } from "@src/database/repository/school.repository";
import {
  StudentEmailVerificationRepository,
  StudentEmailVerificationRow,
} from "@src/database/repository/student-email-verification.repository";
import {
  StudentRepository,
  StudentRow,
} from "@src/database/repository/student.repository";
import { BaseResultDto } from "@src/global/dto/base-result.dto";
import { TxType } from "@src/global/types/tx.types";
import { MailService } from "@src/mail/mail.service";
import { StudentVerificationService } from "./student-verification.service";

const userPk = "690c15dc-0000-4000-8000-000000000001";
const email = "gildong@gm.gist.ac.kr";
const now = new Date("2026-10-25T12:00:00.000Z");

// 서비스와 같은 방식으로 HMAC 키를 파생 (JWT_PRIVATE_KEY = "test-jwt-key")
const hashKey = createHmac("sha256", "test-jwt-key")
  .update("student-email-verification-code")
  .digest();
const hash = (code: string) =>
  createHmac("sha256", hashKey).update(code).digest("hex");

const student: StudentRow = {
  pk: "student-pk",
  userPk,
  email: null,
  verifiedAt: null,
  createdAt: now,
  updatedAt: now,
};

const verification = (
  overrides: Partial<StudentEmailVerificationRow> = {},
): StudentEmailVerificationRow => ({
  studentPk: student.pk,
  attemptCount: 0,
  code: hash("482913"),
  expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
  createdAt: now,
  email,
  ...overrides,
});

describe("StudentVerificationService", () => {
  const tx = {} as TxType;
  const order: string[] = [];
  const dbService = {
    db: {
      transaction: jest.fn(async (fn: (tx: TxType) => unknown) => {
        const result = await fn(tx);
        order.push("commit");
        return result;
      }),
    },
  };
  const mailService = {
    sendAsync: jest.fn(() => order.push("sendAsync")),
  };
  const schoolRepository = { findByEmailDomain: jest.fn() };
  const studentRepository = {
    findByUserPkForUpdate: jest.fn(),
    existsByEmailExcept: jest.fn(),
    markVerified: jest.fn(),
  };
  const verificationRepository = {
    findByStudentPk: jest.fn(),
    upsert: jest.fn(),
    incrementAttemptCount: jest.fn(),
    deleteByStudentPk: jest.fn(),
  };
  const configService = {
    get: (key: string) =>
      key === "JWT_PRIVATE_KEY" ? "test-jwt-key" : undefined,
  };
  const service = new StudentVerificationService(
    configService as unknown as ConfigService,
    dbService as unknown as DatabaseService,
    mailService as unknown as MailService,
    schoolRepository as unknown as SchoolRepository,
    studentRepository as unknown as StudentRepository,
    verificationRepository as unknown as StudentEmailVerificationRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now });
    order.length = 0;
    schoolRepository.findByEmailDomain.mockResolvedValue({
      pk: 1,
      name: "GIST",
      emailDomain: "gm.gist.ac.kr",
    });
    studentRepository.findByUserPkForUpdate.mockResolvedValue(student);
    studentRepository.existsByEmailExcept.mockResolvedValue(false);
    verificationRepository.findByStudentPk.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("sendCode", () => {
    it("stores only the HMAC of a fresh 6-digit code and mails the code after commit", async () => {
      await expect(service.sendCode(userPk, email)).resolves.toEqual({
        expires_at: new Date("2026-10-25T12:05:00.000Z"),
        resend_available_at: new Date("2026-10-25T12:01:00.000Z"),
      });

      expect(schoolRepository.findByEmailDomain).toHaveBeenCalledWith(
        "gm.gist.ac.kr",
      );
      expect(studentRepository.findByUserPkForUpdate).toHaveBeenCalledWith(
        userPk,
        tx,
      );
      expect(studentRepository.existsByEmailExcept).toHaveBeenCalledWith(
        email,
        student.pk,
        tx,
      );
      const [[row]] = verificationRepository.upsert.mock.calls as [
        [{ code: string }],
      ];
      expect(row).toEqual({
        studentPk: student.pk,
        email,
        code: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
        expiresAt: new Date("2026-10-25T12:05:00.000Z"),
        createdAt: now,
      });
      const [[mail]] = mailService.sendAsync.mock.calls as unknown as [
        [{ to: string; text: string }],
      ];
      const mailedCode = /인증번호: (\d{6})/.exec(mail.text)?.[1];
      expect(mail.to).toBe(email);
      expect(mailedCode).toBeDefined();
      expect(row.code).toBe(hash(mailedCode!));
      expect(order).toEqual(["commit", "sendAsync"]);
    });

    it("returns 400 for a domain that is not a registered school", async () => {
      schoolRepository.findByEmailDomain.mockResolvedValue(null);

      await expect(
        service.sendCode(userPk, "gildong@gist.ac.kr"),
      ).rejects.toThrow(new BadRequestException("Email domain not allowed"));
      expect(dbService.db.transaction).not.toHaveBeenCalled();
      expect(mailService.sendAsync).not.toHaveBeenCalled();
    });

    it("returns 429 within 60 seconds of the last send, even after attempts ran out", async () => {
      verificationRepository.findByStudentPk.mockResolvedValue(
        verification({
          createdAt: new Date(now.getTime() - 59_000),
          attemptCount: 5,
        }),
      );

      const error = await service.sendCode(userPk, email).catch((e) => e);
      expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(verificationRepository.upsert).not.toHaveBeenCalled();
      expect(mailService.sendAsync).not.toHaveBeenCalled();
    });

    it("resends once the cooldown has passed", async () => {
      verificationRepository.findByStudentPk.mockResolvedValue(
        verification({ createdAt: new Date(now.getTime() - 60_000) }),
      );

      await service.sendCode(userPk, email);

      expect(verificationRepository.upsert).toHaveBeenCalled();
      expect(mailService.sendAsync).toHaveBeenCalled();
    });

    it("returns 403 when the user switched to graduated after the guard", async () => {
      studentRepository.findByUserPkForUpdate.mockResolvedValue(null);

      await expect(service.sendCode(userPk, email)).rejects.toThrow(
        new ForbiddenException("User type not allowed"),
      );
      expect(verificationRepository.upsert).not.toHaveBeenCalled();
    });

    it("returns 409 when another account already verified the email", async () => {
      studentRepository.existsByEmailExcept.mockResolvedValue(true);

      await expect(service.sendCode(userPk, email)).rejects.toThrow(
        ConflictException,
      );
      expect(verificationRepository.upsert).not.toHaveBeenCalled();
      expect(mailService.sendAsync).not.toHaveBeenCalled();
    });
  });

  describe("verifyCode", () => {
    it("records the verified email and deletes the request on a match", async () => {
      verificationRepository.findByStudentPk.mockResolvedValue(verification());

      await expect(service.verifyCode(userPk, "482913")).resolves.toBe(
        BaseResultDto.OK,
      );
      expect(studentRepository.markVerified).toHaveBeenCalledWith(
        student.pk,
        email,
        tx,
      );
      expect(verificationRepository.deleteByStudentPk).toHaveBeenCalledWith(
        student.pk,
        tx,
      );
    });

    it.each([
      ["there is no request", null],
      ["attempts ran out", verification({ attemptCount: 5 })],
    ])("returns 404 when %s", async (_, row) => {
      verificationRepository.findByStudentPk.mockResolvedValue(row);

      await expect(service.verifyCode(userPk, "482913")).rejects.toThrow(
        new NotFoundException("No verification in progress"),
      );
      expect(studentRepository.markVerified).not.toHaveBeenCalled();
    });

    it("returns 410 for an expired code", async () => {
      verificationRepository.findByStudentPk.mockResolvedValue(
        verification({ expiresAt: now }),
      );

      await expect(service.verifyCode(userPk, "482913")).rejects.toThrow(
        GoneException,
      );
      expect(
        verificationRepository.incrementAttemptCount,
      ).not.toHaveBeenCalled();
    });

    it.each([
      [1, 4],
      [5, 0],
    ])(
      "commits the failed attempt (#%i) and returns 400 with %i remaining",
      async (attemptCount, remaining) => {
        verificationRepository.findByStudentPk.mockResolvedValue(
          verification({ attemptCount: attemptCount - 1 }),
        );
        verificationRepository.incrementAttemptCount.mockResolvedValue(
          attemptCount,
        );

        const error = (await service
          .verifyCode(userPk, "000000")
          .catch((e) => e)) as BadRequestException;

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.getResponse()).toEqual({
          message: "Invalid verification code",
          remaining_attempts: remaining,
        });
        // 트랜잭션 안에서 던지지 않아야 시도 횟수가 커밋됨
        expect(order).toEqual(["commit"]);
        expect(verificationRepository.deleteByStudentPk).not.toHaveBeenCalled();
        expect(studentRepository.markVerified).not.toHaveBeenCalled();
      },
    );

    it("returns 409 when the email UNIQUE constraint is hit concurrently", async () => {
      verificationRepository.findByStudentPk.mockResolvedValue(verification());
      studentRepository.markVerified.mockRejectedValue(
        Object.assign(new Error("Failed query"), {
          cause: { code: "23505" },
        }),
      );

      const error = (await service
        .verifyCode(userPk, "482913")
        .catch((e) => e)) as ConflictException;
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe("Email already verified by another account");
    });
  });
});
