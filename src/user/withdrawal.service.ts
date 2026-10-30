import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
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
  WithdrawalCutoffs,
} from "@src/database/repository/user.repository";
import { FileService } from "@src/file/file.service";
import { BaseResultDto } from "@src/global/dto/base-result.dto";

const DAY_MS = 24 * 60 * 60 * 1000;
// 한 번에 조회할 만료 대상 수. 처리는 유저마다 트랜잭션을 나눔
const PURGE_BATCH_SIZE = 100;
// 가입 중(pending)에 탈퇴한 유저는 하루 뒤에 처리
const PENDING_GRACE_DAYS = 1;

// 회원 탈퇴는 요청 → 유예기간 → 스케줄러가 삭제 순서로 진행.
// 유예기간: 가입을 마친(active) 유저는 WITHDRAWAL_GRACE_DAYS(기본 30일), 가입 중(pending)이면 1일.
// 유예기간 중에는 비활성(토큰 폐기, 다른 회원에게 안 보임)이고, 다시 로그인하면 취소됨 (UserService.login)
@Injectable()
export class WithdrawalService {
  private readonly logger = new Logger(WithdrawalService.name);
  private readonly graceDays: number;

  constructor(
    configService: ConfigService,
    private readonly dbService: DatabaseService,
    private readonly authService: AuthService,
    private readonly fileService: FileService,
    private readonly userRepository: UserRepository,
    private readonly userOauthAccountRepository: UserOauthAccountRepository,
    private readonly studentRepository: StudentRepository,
    private readonly studentEmailVerificationRepository: StudentEmailVerificationRepository,
    private readonly studentEmailSendLogRepository: StudentEmailSendLogRepository,
    private readonly studentProfileAttachmentRepository: StudentProfileAttachmentRepository,
    private readonly graduatedRepository: GraduatedRepository,
    private readonly coffeeChatContactRepository: CoffeeChatContactRepository,
  ) {
    // 빈 값(WITHDRAWAL_GRACE_DAYS=)은 미설정으로 봄. Number("")가 0이 되어 유예 없이 삭제되는 것을 막음
    const raw = configService.get<string>("WITHDRAWAL_GRACE_DAYS")?.trim();
    const graceDays = raw ? Number(raw) : 30;
    if (!Number.isInteger(graceDays) || graceDays < 0) {
      throw new Error(
        "WITHDRAWAL_GRACE_DAYS must be a non-negative integer (number of days).",
      );
    }
    this.graceDays = graceDays;
  }

  // 탈퇴 요청 (가입 중인 pending 유저도 가능, 이 경우 유예기간 1일). 개인정보는 유예기간이 끝난 뒤 purgeExpired에서 지움.
  // 유저 행을 먼저 잠가서 다른 기기의 동시 로그인(탈퇴 취소)과 겹치지 않게 함
  async request(userCtx: UserContext): Promise<BaseResultDto> {
    await this.dbService.db.transaction(async (tx) => {
      const user = await this.userRepository.findByPkForUpdate(
        userCtx.userPk,
        tx,
      );
      if (!user) {
        // 이미 탈퇴했거나 탈퇴 요청한 유저
        throw new UnauthorizedException("User not found");
      }

      await this.userRepository.requestWithdrawal(user.pk, tx);
      // 모든 기기에서 로그아웃. 남은 access token은 만료까지 UserGuard를 통과할 수 있음 (CRB-4 결정)
      await this.authService.revokeAllTokens(user.pk, tx);
    });
    return BaseResultDto.OK;
  }

  // 유예기간이 끝난 탈퇴 요청을 처리 (WithdrawalScheduler가 하루 한 번 호출). 처리한 유저 수를 반환.
  // 유저마다 트랜잭션을 나눠서 한 명이 실패해도 나머지는 진행하고, 실패한 유저는 다음 실행에서 다시 시도
  async purgeExpired(now: Date = new Date()): Promise<number> {
    const cutoffs: WithdrawalCutoffs = {
      activeRequestedBefore: new Date(now.getTime() - this.graceDays * DAY_MS),
      pendingRequestedBefore: new Date(
        now.getTime() - PENDING_GRACE_DAYS * DAY_MS,
      ),
    };
    // 이번 실행에서 이미 시도한 유저 (처리 · 실패 · 다른 인스턴스가 잠금). 같은 유저를 다시 조회하지 않음
    const attempted: string[] = [];
    let purged = 0;

    for (;;) {
      const pks = await this.userRepository.findWithdrawalDuePks(
        cutoffs,
        PURGE_BATCH_SIZE,
        attempted,
      );
      if (pks.length === 0) break;

      for (const pk of pks) {
        attempted.push(pk);
        try {
          if (await this.purge(pk, cutoffs)) purged++;
        } catch (e) {
          this.logger.error(
            `Failed to purge withdrawn user ${pk}: ${(e as Error).message}`,
          );
        }
      }
    }
    return purged;
  }

  // 지움: OAuth 계정, refresh token, 연락 설정(coffee_chat_contact), 명함 S3 파일 + key, 이력서 · 포트폴리오 파일 + 첨부 행,
  //       users.name / email, student.email (같은 학교 이메일로 재가입 가능하도록)과 진행 중인 학교 이메일 인증 요청 · 전송 기록
  // 남김: 약관 동의 이력, student / graduated 행, 재학생 프로필 버전과 링크 첨부, 현업자 프로필(닉네임 · 회사 · 부서 · 직무 · 해시태그 · 링크),
  //       커피챗 요청(공유된 연락처 shared_phone / shared_email 포함)과 알림 로그 — 상대방의 커피챗 기록이 참조함.
  // 반환값: 처리했으면 true, 다른 인스턴스가 처리 중이거나 그 사이 탈퇴가 취소됐으면 false
  private async purge(
    userPk: string,
    cutoffs: WithdrawalCutoffs,
  ): Promise<boolean> {
    const result = await this.dbService.db.transaction(async (tx) => {
      const user = await this.userRepository.lockWithdrawalDue(
        userPk,
        cutoffs,
        tx,
      );
      if (!user) return null;

      await this.userOauthAccountRepository.deleteByUserPk(user.pk, tx);
      await this.authService.revokeAllTokens(user.pk, tx);
      await this.coffeeChatContactRepository.deleteByUserPk(user.pk, tx);
      // 재학생이었다가 유형을 바꾼 유저에게도 기록이 남아 있어 유형과 상관없이 지움
      await this.studentEmailSendLogRepository.deleteByUserPk(user.pk, tx);
      let businessCardKey: string | null = null;
      let attachmentKeys: string[] = [];
      if (user.type === "student") {
        const student = await this.studentRepository.findByUserPk(user.pk, tx);
        if (student) {
          // 진행 중인 인증 요청에도 입력한 gist 이메일이 남아 있어 같이 지움
          await this.studentEmailVerificationRepository.deleteByStudentPk(
            student.pk,
            tx,
          );
          await this.studentRepository.clearEmailByUserPk(user.pk, tx);
          // 탈퇴한 학생의 커피챗 상세는 410이라 이력서를 볼 사람이 없음. 행까지 지워야 파일 삭제 실패분을 OrphanFileService가 정리함
          attachmentKeys =
            await this.studentProfileAttachmentRepository.deleteFilesByStudentPk(
              student.pk,
              tx,
            );
        }
      } else {
        const graduated = await this.graduatedRepository.findByUserPk(
          user.pk,
          tx,
        );
        if (graduated?.businessCardKey) {
          await this.graduatedRepository.clearBusinessCardKey(graduated.pk, tx);
          businessCardKey = graduated.businessCardKey;
        }
      }
      await this.userRepository.withdraw(user.pk, tx);
      return { businessCardKey, attachmentKeys };
    });
    if (!result) return false;

    // DB 정리가 끝난 뒤에 지움. 실패해도 DB에는 참조가 없으므로 로그만 남김
    if (result.businessCardKey) {
      await this.fileService.deleteFileQuietly(result.businessCardKey);
    }
    await Promise.all(
      result.attachmentKeys.map((key) =>
        this.fileService.deleteFileQuietly(key),
      ),
    );
    return true;
  }
}
