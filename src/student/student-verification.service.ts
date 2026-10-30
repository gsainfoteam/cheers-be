import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "@src/database/database.service";
import { SchoolRepository } from "@src/database/repository/school.repository";
import {
  StudentEmailSendLogRepository,
  StudentEmailSendLogRow,
} from "@src/database/repository/student-email-send-log.repository";
import { StudentEmailVerificationRepository } from "@src/database/repository/student-email-verification.repository";
import {
  StudentRepository,
  StudentRow,
} from "@src/database/repository/student.repository";
import { BaseResultDto } from "@src/global/dto/base-result.dto";
import { isUniqueViolation } from "@src/global/exceptions/pg-error";
import { TxType } from "@src/global/types/tx.types";
import { MailService } from "@src/mail/mail.service";
import { buildVerificationCodeMail } from "@src/mail/templates/verification-code.template";
import { SendCodeResponseDto } from "./dto/send-code.dto";
import {
  VERIFICATION_CODE_TTL_MINUTES,
  VERIFICATION_CODE_TTL_MS,
  VERIFICATION_MAX_ATTEMPTS,
  VERIFICATION_MAX_FAILED_ATTEMPTS,
  VERIFICATION_MAX_SENDS_PER_EMAIL,
  VERIFICATION_MAX_SENDS_PER_USER,
  VERIFICATION_RESEND_COOLDOWN_MS,
  VERIFICATION_SEND_WINDOW_MS,
} from "./student.constants";
import { emailDomain } from "./student.utils";

type VerifyResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "expired" }
  | { kind: "wrong"; remainingAttempts: number };

// 재학생 학교 이메일 인증 (가입 단계 verify)
@Injectable()
export class StudentVerificationService {
  // 인증번호는 HMAC으로만 저장. 6자리라 키 없는 해시는 100만 번이면 되돌릴 수 있어서 서버 비밀값을 키로 씀
  private readonly codeHashKey: Buffer;

  constructor(
    configService: ConfigService,
    private readonly dbService: DatabaseService,
    private readonly mailService: MailService,
    private readonly schoolRepository: SchoolRepository,
    private readonly studentRepository: StudentRepository,
    private readonly studentEmailVerificationRepository: StudentEmailVerificationRepository,
    private readonly studentEmailSendLogRepository: StudentEmailSendLogRepository,
  ) {
    // 새 env를 늘리지 않으려고 이미 필수인 JWT 서명 키에서 용도별 키를 파생 (AuthService가 존재를 검사)
    this.codeHashKey = createHmac(
      "sha256",
      configService.get<string>("JWT_PRIVATE_KEY") ?? "",
    )
      .update("student-email-verification-code")
      .digest();
  }

  // 재전송도 같은 API. 이전 코드는 덮어써서 무효
  async sendCode(userPk: string, email: string): Promise<SendCodeResponseDto> {
    const school = await this.schoolRepository.findByEmailDomain(
      emailDomain(email),
    );
    if (!school) {
      throw new BadRequestException("Email domain not allowed");
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + VERIFICATION_CODE_TTL_MS);

    await this.dbService.db.transaction(async (tx) => {
      const student = await this.lockStudent(userPk, tx);

      const current =
        await this.studentEmailVerificationRepository.findByStudentPk(
          student.pk,
          tx,
        );
      // 시도 횟수를 다 쓴 요청 · 만료된 요청도 created_at 기준으로 기다림
      if (
        current &&
        current.createdAt.getTime() + VERIFICATION_RESEND_COOLDOWN_MS >
          createdAt.getTime()
      ) {
        throw tooManyRequests(
          "Resend is not available yet",
          new Date(
            current.createdAt.getTime() + VERIFICATION_RESEND_COOLDOWN_MS,
          ),
        );
      }

      // 탈퇴 유예기간 중인 계정도 이메일을 갖고 있어 막힘. 만료 처리 때 student.email이 비워지면 풀림
      if (
        await this.studentRepository.existsByEmailExcept(email, student.pk, tx)
      ) {
        throw new ConflictException(
          "Email already verified by another account",
        );
      }

      await this.assertSendAllowed(userPk, email, createdAt, tx);

      await this.studentEmailVerificationRepository.upsert(
        {
          studentPk: student.pk,
          email,
          code: this.hashCode(code),
          expiresAt,
          createdAt,
        },
        tx,
      );
      // 틀린 횟수를 이 기록에 쌓으려고 인증 요청과 같은 created_at을 씀
      await this.studentEmailSendLogRepository.insert(
        { userPk, email, createdAt },
        tx,
      );
    });

    // 커밋 뒤에 보냄. 실패는 MailService가 로그 + Slack으로 처리하고, 사용자는 재전송
    this.mailService.sendAsync(
      buildVerificationCodeMail(email, code, VERIFICATION_CODE_TTL_MINUTES),
    );

    return {
      expires_at: expiresAt,
      resend_available_at: new Date(
        createdAt.getTime() + VERIFICATION_RESEND_COOLDOWN_MS,
      ),
    };
  }

  async verifyCode(userPk: string, code: string): Promise<BaseResultDto> {
    let result: VerifyResult;
    try {
      // 틀린 횟수가 커밋되도록 트랜잭션 안에서는 결과만 정하고 예외는 밖에서 던짐
      result = await this.dbService.db.transaction((tx) =>
        this.checkCode(userPk, code, tx),
      );
    } catch (e) {
      // 다른 계정이 같은 이메일을 방금 인증함 (student.email UNIQUE)
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          "Email already verified by another account",
          { cause: e },
        );
      }
      throw e;
    }

    switch (result.kind) {
      case "not_found":
        throw new NotFoundException("No verification in progress");
      case "expired":
        throw new GoneException("Verification code expired");
      case "wrong":
        throw new BadRequestException({
          message: "Invalid verification code",
          remaining_attempts: result.remainingAttempts,
        });
      case "ok":
        return BaseResultDto.OK;
    }
  }

  private async checkCode(
    userPk: string,
    code: string,
    tx: TxType,
  ): Promise<VerifyResult> {
    // 동시에 여러 번 확인해도 시도 횟수가 정확히 쌓이도록 학생 행을 잠금
    const student = await this.lockStudent(userPk, tx);
    const verification =
      await this.studentEmailVerificationRepository.findByStudentPk(
        student.pk,
        tx,
      );

    if (
      !verification ||
      verification.attemptCount >= VERIFICATION_MAX_ATTEMPTS
    ) {
      return { kind: "not_found" };
    }
    // 만료된 행은 만료 인증번호 정리 스케줄러가 지움 (CRB-29)
    if (verification.expiresAt.getTime() <= Date.now()) {
      return { kind: "expired" };
    }

    if (!hashEquals(verification.code, this.hashCode(code))) {
      // 5번째로 틀려도 행은 남겨 둬서 이후 확인은 404, 재전송 대기도 유지
      const attemptCount =
        await this.studentEmailVerificationRepository.incrementAttemptCount(
          student.pk,
          tx,
        );
      // attempt_count는 재전송하면 초기화되므로 전송 기록에도 누적
      await this.studentEmailSendLogRepository.incrementFailedAttemptCount(
        userPk,
        verification.createdAt,
        tx,
      );
      return {
        kind: "wrong",
        remainingAttempts: Math.max(
          VERIFICATION_MAX_ATTEMPTS - attemptCount,
          0,
        ),
      };
    }

    await this.studentRepository.markVerified(
      student.pk,
      verification.email,
      tx,
    );
    await this.studentEmailVerificationRepository.deleteByStudentPk(
      student.pk,
      tx,
    );
    return { kind: "ok" };
  }

  // 최근 24시간 상한. 이메일 기준은 학생 행 잠금으로 직렬화되지 않아 계정 여러 개가 동시에 보내면
  // 조금 넘을 수 있지만, 계정마다 유저 상한이 있어 추가로 잠그지 않음
  private async assertSendAllowed(
    userPk: string,
    email: string,
    now: Date,
    tx: TxType,
  ): Promise<void> {
    const since = new Date(now.getTime() - VERIFICATION_SEND_WINDOW_MS);

    const userLogs =
      await this.studentEmailSendLogRepository.findRecentByUserPk(
        userPk,
        since,
        tx,
      );
    assertUnderLimit(
      userLogs,
      () => 1,
      VERIFICATION_MAX_SENDS_PER_USER,
      "Daily send limit exceeded",
    );
    // 이메일 기준으로 세면 계정 하나로 일부러 틀려서 피해자의 인증을 막을 수 있어 유저 기준
    assertUnderLimit(
      userLogs,
      (log) => log.failedAttemptCount,
      VERIFICATION_MAX_FAILED_ATTEMPTS,
      "Too many failed attempts",
    );

    const emailLogs =
      await this.studentEmailSendLogRepository.findRecentByEmail(
        email,
        since,
        tx,
      );
    assertUnderLimit(
      emailLogs,
      () => 1,
      VERIFICATION_MAX_SENDS_PER_EMAIL,
      "Daily send limit exceeded for this email",
    );
  }

  private hashCode(code: string): string {
    return createHmac("sha256", this.codeHashKey).update(code).digest("hex");
  }

  private async lockStudent(userPk: string, tx: TxType): Promise<StudentRow> {
    const student = await this.studentRepository.findByUserPkForUpdate(
      userPk,
      tx,
    );
    // 가드 통과 뒤 다른 기기에서 현업자로 유형을 바꾸면 재학생 행이 없음 (현업자 API와 같은 403)
    if (!student) {
      throw new ForbiddenException("User type not allowed");
    }
    return student;
  }
}

const tooManyRequests = (message: string, retryAvailableAt: Date) =>
  new HttpException(
    { message, retry_available_at: retryAvailableAt },
    HttpStatus.TOO_MANY_REQUESTS,
  );

// logs는 오래된 순. 상한에 닿았으면 오래된 기록부터 기간이 지나 상한 아래로 내려가는 시각을 알려 줌
const assertUnderLimit = (
  logs: StudentEmailSendLogRow[],
  weight: (log: StudentEmailSendLogRow) => number,
  limit: number,
  message: string,
): void => {
  let total = logs.reduce((sum, log) => sum + weight(log), 0);
  if (total < limit) return;

  for (const log of logs) {
    total -= weight(log);
    if (total < limit) {
      throw tooManyRequests(
        message,
        new Date(log.createdAt.getTime() + VERIFICATION_SEND_WINDOW_MS),
      );
    }
  }
};

const hashEquals = (expected: string, actual: string): boolean => {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
};
