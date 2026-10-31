import { LogWriter } from "drizzle-orm/logger";
import { entityKind } from "drizzle-orm";
import { LoggerService } from "@src/global/logger/logger.service";

const REDACTED_TABLES = ["jwt_signing_key", "admin_access_log"];

export class QueryLogWriter implements LogWriter {
  static [entityKind] = "QueryLogWriter";

  constructor(private readonly loggerService: LoggerService) {}

  write(message: string): void {
    // drizzle 로거는 파라미터까지 메시지에 넣음. 개인키 · 어드민 이메일이 로그에 남지 않도록 내용을 통째로 뺌
    const redacted = REDACTED_TABLES.find((table) => message.includes(table));
    if (redacted) {
      this.loggerService.queryLog(`Query: ${redacted} (redacted)`);
      return;
    }
    this.loggerService.queryLog(message);
  }
}
