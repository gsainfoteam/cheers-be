import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { CleanupService } from "@src/user/cleanup.service";

// 매일 03:00 (KST) 가입 미완료 계정, 03:30 (KST) 만료된 인증 데이터를 지움 (탈퇴 스케줄러 04:00과 겹치지 않게 분리).
// 서버가 여러 대여도 안전: 가입 미완료 계정은 유저마다 FOR UPDATE SKIP LOCKED로 잠그고,
// 만료 데이터는 단순 DELETE라 동시에 실행돼도 같은 행을 두 번 지울 뿐임
@Injectable()
export class CleanupScheduler {
  private readonly logger = new Logger(CleanupScheduler.name);

  constructor(private readonly cleanupService: CleanupService) {}

  @Cron("0 0 3 * * *", {
    name: "incomplete-signup-purge",
    timeZone: "Asia/Seoul",
  })
  async purgeIncompleteSignups(): Promise<void> {
    try {
      const count = await this.cleanupService.purgeIncompleteSignups();
      this.logger.log(`Deleted ${count} incomplete signup(s)`);
    } catch (e) {
      this.logger.error(
        `Incomplete signup purge failed: ${(e as Error).message}`,
        (e as Error).stack,
      );
    }
  }

  @Cron("0 30 3 * * *", { name: "expired-data-purge", timeZone: "Asia/Seoul" })
  async purgeExpiredData(): Promise<void> {
    const result = await this.cleanupService.purgeExpiredData();
    this.logger.log(
      `Deleted expired data (verification ${result.verifications}, send log ${result.sendLogs}, refresh token ${result.refreshTokens})`,
    );
  }
}
