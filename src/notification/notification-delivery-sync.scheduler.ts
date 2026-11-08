import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { NotificationDeliverySyncService } from "./notification-delivery-sync.service";

// 매분 접수된 알림톡의 카카오 최종 결과를 알리고에서 가져옴 (CRB-77).
// 서버가 여러 대여도 행을 FOR UPDATE SKIP LOCKED로 잡고 lease만큼 미루므로 같은 행을 동시에 조회하지 않음
@Injectable()
export class NotificationDeliverySyncScheduler {
  private readonly logger = new Logger(NotificationDeliverySyncScheduler.name);
  // 조회가 느려 1분을 넘기면 같은 서버에서 다음 실행이 겹치지 않게 건너뜀
  private running = false;

  constructor(private readonly syncService: NotificationDeliverySyncService) {}

  @Cron("30 * * * * *", {
    name: "notification-delivery-sync",
    timeZone: "Asia/Seoul",
  })
  async syncDue(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.syncService.syncDue();
      if (result.delivered + result.failed + result.unknown > 0) {
        this.logger.log(
          `Alimtalk delivery sync: delivered ${result.delivered}, failed ${result.failed}, unknown ${result.unknown}, pending ${result.pending}`,
        );
      }
    } catch (e) {
      this.logger.error(
        `Alimtalk delivery sync failed: ${(e as Error).message}`,
        (e as Error).stack,
      );
    } finally {
      this.running = false;
    }
  }
}
