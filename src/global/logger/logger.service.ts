import { Injectable, LoggerService as LS } from "@nestjs/common";
import { utilities as nestWinstonModuleUtilities } from "nest-winston";
import {
  createLogger as createWinstonLogger,
  format as winstonFormat,
  Logger as winstonLogger,
  transports as winstonTransports,
} from "winston";
import { ConfigService } from "@nestjs/config";

const { errors, combine, timestamp, ms, printf } = winstonFormat;

@Injectable()
export class LoggerService implements LS {
  private logger: winstonLogger;
  private queryLogger: winstonLogger;
  private queryTimeLogger: winstonLogger;

  constructor(private readonly configService: ConfigService) {
    // drizzle 쿼리 로그는 양이 많고 파라미터에 개인정보가 섞일 수 있어 QUERY_LOG=true 일 때만 출력
    const queryLogSilent =
      this.configService.get<string>("QUERY_LOG") !== "true";

    this.logger = createWinstonLogger({
      format: combine(
        errors({ stack: true }),
        timestamp({ format: "isoDateTime" }),
        ms(),
        printf(
          (info) =>
            `[${info.timestamp}][${info.level.toUpperCase()}] ${info.message}`,
        ),
      ),
      transports: [
        new winstonTransports.Console({
          level: "debug",
          format: combine(
            nestWinstonModuleUtilities.format.nestLike("Cheers", {
              prettyPrint: true,
            }),
          ),
        }),
      ],
    });

    this.queryLogger = createWinstonLogger({
      format: combine(
        errors({ stack: true }),
        timestamp({ format: "isoDateTime" }),
        ms(),
        printf((info) => `[${info.timestamp}][DB QUERY] ${info.message}`),
      ),
      transports: [new winstonTransports.Console({ silent: queryLogSilent })],
    });

    this.queryTimeLogger = createWinstonLogger({
      format: combine(
        errors({ stack: true }),
        timestamp({ format: "isoDateTime" }),
        ms(),
        printf((info) => `[${info.timestamp}][DB QUERY TIME] ${info.message}`),
      ),
      transports: [new winstonTransports.Console({ silent: queryLogSilent })],
    });

    console.log = (message: any, params?: any) => {
      this.logger.debug(message, params);
    };
  }

  log(message: string) {
    this.logger.info(message);
  }
  error(message: string, trace: string) {
    this.logger.error(message, trace);
  }
  warn(message: string) {
    this.logger.warn(message);
  }
  debug(message: string) {
    this.logger.debug(message);
  }
  verbose(message: string) {
    this.logger.verbose(message);
  }

  queryLog(message: string) {
    this.queryLogger.info(message);
  }

  queryTimeLog(queryName: string, startTime: number) {
    const duration = Date.now() - startTime;
    this.queryTimeLogger.info(`(${duration}ms) ${queryName}`);
  }
}
