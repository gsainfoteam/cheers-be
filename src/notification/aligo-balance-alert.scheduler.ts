import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { AligoBalanceAlertService } from "./aligo-balance-alert.service";

// 매시 정각에 알리고 잔여량을 확인해 부족하면 Slack으로 알림 (CRB-78)
@Injectable()
export class AligoBalanceAlertScheduler {
  private readonly logger = new Logger(AligoBalanceAlertScheduler.name);
  // 조회가 느려 다음 실행과 겹치지 않게 건너뜀
  private running = false;

  constructor(private readonly alertService: AligoBalanceAlertService) {}

  @Cron("0 0 * * * *", {
    name: "aligo-balance-alert",
    timeZone: "Asia/Seoul",
  })
  async check(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.alertService.check();
    } catch (e) {
      this.logger.error(
        `Aligo balance alert failed: ${(e as Error).message}`,
        (e as Error).stack,
      );
    } finally {
      this.running = false;
    }
  }
}
