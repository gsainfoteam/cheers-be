import { LogWriter } from "drizzle-orm/logger";
import { entityKind } from "drizzle-orm";
import { LoggerService } from "@src/global/logger/logger.service";

export class QueryLogWriter implements LogWriter {
  static [entityKind] = "QueryLogWriter";

  constructor(private readonly loggerService: LoggerService) {}

  write(message: string): void {
    // drizzle 로거는 파라미터까지 메시지에 넣음. 개인키가 로그에 남지 않도록 내용을 통째로 뺌
    if (message.includes("jwt_signing_key")) {
      this.loggerService.queryLog("Query: jwt_signing_key (redacted)");
      return;
    }
    this.loggerService.queryLog(message);
  }
}
