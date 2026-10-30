import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { OrphanFileService } from "./orphan-file.service";

// 매주 일요일 04:30 (KST) DB에서 참조하지 않는 S3 파일을 지움 (탈퇴 스케줄러 04:00 뒤).
// 서버가 여러 대여도 안전: 같은 파일을 두 번 지워도 결과가 같고, 삭제 대상은 24시간 넘게 참조되지 않은 파일뿐임
@Injectable()
export class OrphanFileScheduler {
  private readonly logger = new Logger(OrphanFileScheduler.name);

  constructor(private readonly orphanFileService: OrphanFileService) {}

  @Cron("0 30 4 * * 0", {
    name: "orphan-file-cleanup",
    timeZone: "Asia/Seoul",
  })
  async cleanup(): Promise<void> {
    try {
      const result = await this.orphanFileService.cleanup();
      this.logger.log(
        `Orphan files: scanned ${result.scanned}, orphan ${result.orphans}, deleted ${result.deleted}, failed ${result.failed}`,
      );
    } catch (e) {
      this.logger.error(
        `Orphan file cleanup failed: ${(e as Error).message}`,
        (e as Error).stack,
      );
    }
  }
}
