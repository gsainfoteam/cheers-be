import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { CheersNotificationRetryService } from "./cheers-notification-retry.service";

// 매분 발송에 실패한 커피챗 알림을 다시 보냄 (CRB-75).
// 서버가 여러 대여도 로그마다 FOR UPDATE SKIP LOCKED로 잠그므로 같은 로그를 두 번 보내지 않음
@Injectable()
export class CheersNotificationRetryScheduler {
  private readonly logger = new Logger(CheersNotificationRetryScheduler.name);
  // 발송이 느려 1분을 넘기면 같은 서버에서 다음 실행이 겹치지 않게 건너뜀
  private running = false;

  constructor(private readonly retryService: CheersNotificationRetryService) {}

  @Cron("0 * * * * *", { name: "notification-retry", timeZone: "Asia/Seoul" })
  async retryDue(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.retryService.retryDue();
      if (result.sent + result.failed + result.gaveUp + result.dropped > 0) {
        this.logger.log(
          `Notification retry: sent ${result.sent}, failed ${result.failed}, gave up ${result.gaveUp}, dropped ${result.dropped}`,
        );
      }
    } catch (e) {
      this.logger.error(
        `Notification retry failed: ${(e as Error).message}`,
        (e as Error).stack,
      );
    } finally {
      this.running = false;
    }
  }
}
