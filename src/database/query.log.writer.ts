import { LogWriter } from "drizzle-orm/logger";
import { entityKind } from "drizzle-orm";
import { LoggerService } from "@src/global/logger/logger.service";

export class QueryLogWriter implements LogWriter {
  static [entityKind] = "QueryLogWriter";

  constructor(private readonly loggerService: LoggerService) {}

  write(message: string): void {
    this.loggerService.queryLog(message);
  }
}
