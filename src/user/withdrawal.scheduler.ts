import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { WithdrawalService } from "@src/user/withdrawal.service";

// 매일 04:00 (KST) 탈퇴 유예기간이 끝난 유저의 개인정보를 지움.
// 서버가 여러 대여도 유저마다 FOR UPDATE SKIP LOCKED로 잠그므로 같은 유저를 두 번 처리하지 않음
@Injectable()
export class WithdrawalScheduler {
  private readonly logger = new Logger(WithdrawalScheduler.name);

  constructor(private readonly withdrawalService: WithdrawalService) {}

  @Cron("0 0 4 * * *", { name: "withdrawal-purge", timeZone: "Asia/Seoul" })
  async purgeExpired(): Promise<void> {
    try {
      const count = await this.withdrawalService.purgeExpired();
      this.logger.log(`Purged ${count} withdrawn user(s)`);
    } catch (e) {
      this.logger.error(
        `Withdrawal purge failed: ${(e as Error).message}`,
        (e as Error).stack,
      );
    }
  }
}
