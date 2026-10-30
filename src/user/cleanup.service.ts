import { Injectable, Logger } from "@nestjs/common";
import { AuthService } from "@src/auth/auth.service";
import { DatabaseService } from "@src/database/database.service";
import { CoffeeChatContactRepository } from "@src/database/repository/coffee-chat-contact.repository";
import { RefreshTokenRepository } from "@src/database/repository/refresh-token.repository";
import { StudentEmailSendLogRepository } from "@src/database/repository/student-email-send-log.repository";
import { StudentEmailVerificationRepository } from "@src/database/repository/student-email-verification.repository";
import { UserConsentRepository } from "@src/database/repository/user-consent.repository";
import { UserOauthAccountRepository } from "@src/database/repository/user-oauth-account.repository";
import { UserRepository } from "@src/database/repository/user.repository";
import { FileService } from "@src/file/file.service";
import { TxType } from "@src/global/types/tx.types";
import { VERIFICATION_SEND_LOG_RETENTION_MS } from "@src/student/student.constants";
import { UserService } from "@src/user/user.service";

const HOUR_MS = 60 * 60 * 1000;
// 가입 후 · 마지막 활동 후 이 시간이 지난 pending 유저를 지움 (가안)
const INCOMPLETE_SIGNUP_RETENTION_MS = 24 * HOUR_MS;
// 한 번에 조회할 대상 수. 처리는 유저마다 트랜잭션을 나눔
const PURGE_BATCH_SIZE = 100;

export type ExpiredDataPurgeResult = {
  verifications: number;
  sendLogs: number;
  refreshTokens: number;
};

// 주기적 정리 작업 (CleanupScheduler가 호출)
@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    private readonly dbService: DatabaseService,
    private readonly authService: AuthService,
    private readonly fileService: FileService,
    private readonly userService: UserService,
    private readonly userRepository: UserRepository,
    private readonly userOauthAccountRepository: UserOauthAccountRepository,
    private readonly userConsentRepository: UserConsentRepository,
    private readonly coffeeChatContactRepository: CoffeeChatContactRepository,
    private readonly studentEmailSendLogRepository: StudentEmailSendLogRepository,
    private readonly studentEmailVerificationRepository: StudentEmailVerificationRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
  ) {}

  // 가입 미완료(pending) 계정을 hard delete. 삭제한 유저 수를 반환.
  // 탈퇴 요청 · soft delete 여부는 보지 않음 (탈퇴 스케줄러와 겹쳐도 최종 결과가 같음).
  // 유저마다 트랜잭션을 나눠서 한 명이 실패해도 나머지는 진행하고, 실패한 유저는 다음 실행에서 다시 시도
  async purgeIncompleteSignups(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - INCOMPLETE_SIGNUP_RETENTION_MS);
    // 이번 실행에서 이미 시도한 유저 (삭제 · 실패 · 다른 인스턴스가 잠금). 같은 유저를 다시 조회하지 않음
    const attempted: string[] = [];
    let deleted = 0;

    for (;;) {
      const pks = await this.userRepository.findIncompleteSignupPks(
        cutoff,
        PURGE_BATCH_SIZE,
        attempted,
      );
      if (pks.length === 0) break;

      for (const pk of pks) {
        attempted.push(pk);
        try {
          if (await this.deleteIncompleteSignup(pk, cutoff)) deleted++;
        } catch (e) {
          this.logger.error(
            `Failed to delete incomplete signup ${pk}: ${(e as Error).message}`,
          );
        }
      }
    }
    return deleted;
  }

  // 만료된 학교 이메일 인증 요청, 보존 기간이 지난 전송 기록, 만료된 refresh token을 지움.
  // 서로 독립이라 하나가 실패해도 나머지는 실행하고, 실패한 항목은 0으로 보고 로그를 남김
  async purgeExpiredData(
    now: Date = new Date(),
  ): Promise<ExpiredDataPurgeResult> {
    const sendLogBefore = new Date(
      now.getTime() - VERIFICATION_SEND_LOG_RETENTION_MS,
    );
    return {
      verifications: await this.runPurge("expired verification", (tx) =>
        this.studentEmailVerificationRepository.deleteExpired(now, tx),
      ),
      sendLogs: await this.runPurge("old send log", (tx) =>
        this.studentEmailSendLogRepository.deleteOlderThan(sendLogBefore, tx),
      ),
      refreshTokens: await this.runPurge("expired refresh token", (tx) =>
        this.refreshTokenRepository.deleteExpired(tx),
      ),
    };
  }

  private async runPurge(
    label: string,
    purge: (tx: TxType) => Promise<number>,
  ): Promise<number> {
    try {
      return await this.dbService.db.transaction(purge);
    } catch (e) {
      this.logger.error(`Failed to delete ${label}: ${(e as Error).message}`);
      return 0;
    }
  }

  // FK cascade가 없으므로 자식 행부터 지움. 커피챗 요청 · 알림 로그는 active 유저만 만들 수 있어 pending에는 없음.
  // 반환값: 삭제했으면 true, 다른 인스턴스가 처리 중이거나 그 사이 가입을 마치거나 활동했으면 false
  private async deleteIncompleteSignup(
    userPk: string,
    cutoff: Date,
  ): Promise<boolean> {
    const fileKeys = await this.dbService.db.transaction(async (tx) => {
      const user = await this.userRepository.lockIncompleteSignup(
        userPk,
        cutoff,
        tx,
      );
      if (!user) return null;

      await this.authService.revokeAllTokens(user.pk, tx);
      await this.userOauthAccountRepository.deleteByUserPk(user.pk, tx);
      await this.userConsentRepository.deleteByUserPk(user.pk, tx);
      await this.coffeeChatContactRepository.deleteByUserPk(user.pk, tx);
      // 재학생이었다가 유형을 바꾼 유저에게도 기록이 남아 있어 유형과 상관없이 지움
      await this.studentEmailSendLogRepository.deleteByUserPk(user.pk, tx);
      const keys = await this.userService.deleteStudent(user.pk, tx);
      const businessCardKey = await this.userService.deleteGraduated(
        user.pk,
        tx,
      );
      if (businessCardKey) keys.push(businessCardKey);
      await this.userRepository.deleteByPk(user.pk, tx);
      return keys;
    });
    if (!fileKeys) return false;

    // DB 정리가 끝난 뒤에 지움. 실패해도 DB에는 참조가 없으므로 로그만 남김
    for (const key of fileKeys) {
      await this.fileService.deleteFileQuietly(key);
    }
    return true;
  }
}
