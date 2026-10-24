import { Injectable, LoggerService as LS } from "@nestjs/common";
import { utilities as nestWinstonModuleUtilities } from "nest-winston";
import {
  createLogger as createWinstonLogger,
  format as winstonFormat,
  Logger as winstonLogger,
  transports as winstonTransports,
} from "winston";
import "winston-daily-rotate-file";
import { ConfigService } from "@nestjs/config";

const { errors, combine, timestamp, ms, printf } = winstonFormat;

@Injectable()
export class LoggerService implements LS {
  private logger: winstonLogger;
  private queryLogger: winstonLogger;
  private queryTimeLogger: winstonLogger;

  constructor(private readonly configService: ConfigService) {
    const logFilePath = this.configService.get<string>("LOG_PATH");

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
        new winstonTransports.DailyRotateFile({
          filename: `${logFilePath}/cheers-%DATE%.log`,
          zippedArchive: true,
          datePattern: "YYYY-MM-DD",
        }),
        new winstonTransports.DailyRotateFile({
          level: "error",
          filename: `${logFilePath}/error-cheers-%DATE%.log`,
          zippedArchive: true,
          datePattern: "YYYY-MM-DD",
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
      transports: [
        new winstonTransports.DailyRotateFile({
          filename: `${logFilePath}/cheers-query-%DATE%.log`,
          zippedArchive: true,
          datePattern: "YYYY-MM-DD",
        }),
      ],
    });

    this.queryTimeLogger = createWinstonLogger({
      format: combine(
        errors({ stack: true }),
        timestamp({ format: "isoDateTime" }),
        ms(),
        printf((info) => `[${info.timestamp}][DB QUERY TIME] ${info.message}`),
      ),
      transports: [
        new winstonTransports.DailyRotateFile({
          filename: `${logFilePath}/cheers-query-%DATE%.log`, //queryLogger와 queryTimeLogger 둘 다 같은곳에 저장 하는것이 의도
          zippedArchive: true,
          datePattern: "YYYY-MM-DD",
        }),
      ],
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
