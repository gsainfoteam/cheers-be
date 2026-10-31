import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "@src/database/database.service";

// readiness probe의 timeoutSeconds(5초)보다 짧아야 probe가 끊기 전에 503으로 응답함
const DB_CHECK_TIMEOUT_MS = 2000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private ready = true;

  constructor(private readonly databaseService: DatabaseService) {}

  async isReady(): Promise<boolean> {
    try {
      await this.databaseService.ping(DB_CHECK_TIMEOUT_MS);
    } catch (error) {
      // probe가 10초마다 호출하므로 상태가 바뀔 때만 남김
      if (this.ready) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Readiness check failed: ${reason}`);
      }
      this.ready = false;
      return false;
    }

    if (!this.ready) {
      this.logger.log("Readiness check recovered");
    }
    this.ready = true;
    return true;
  }
}
