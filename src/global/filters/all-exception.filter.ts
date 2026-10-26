import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Request, Response } from "express";
import { SlackService } from "nestjs-slack";

// HttpException을 객체로 만들었을 때 statusCode · message · error 외의 필드
// (예: 인증코드 확인의 remaining_attempts)는 응답에 같이 내보냄
const BASE_RESPONSE_FIELDS = new Set(["statusCode", "message", "error"]);

const extraResponseFields = (
  exception: HttpException,
): Record<string, unknown> => {
  const body = exception.getResponse();
  if (typeof body !== "object" || body === null) return {};

  return Object.fromEntries(
    Object.entries(body).filter(([key]) => !BASE_RESPONSE_FIELDS.has(key)),
  );
};

@Catch() // 모든 예외를 캐치
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly slackService: SlackService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();

      // Request 로깅
      this.logger.error(`[Request] ${request.method} ${request.url}`);

      // Response & Stack trace 로깅
      if (exception.stack) {
        this.logger.error(
          `[Response] Status: ${status}, Message: ${exception.message} [Stack] ${exception.stack}`,
        );
      } else {
        this.logger.error(
          `[Response] Status: ${status}, Message: ${exception.message}`,
        );
      }

      response.status(status).json({
        ...extraResponseFields(exception),
        statusCode: status,
        message: exception.message,
      });

      return;
    }

    // Critical 에러 로깅 (스택 트레이스 및 상세 정보 포함)
    let errorMessage: string;
    let stackTrace: string | undefined;

    if (exception instanceof Error) {
      errorMessage = `[CRITICAL][${request.method}][${request.url}] Unexpected Error\nError Name: ${exception.name}\nMessage: ${exception.message}`;
      stackTrace = exception.stack;
    } else {
      errorMessage = `[CRITICAL][${request.method}][${request.url}] Unexpected Error: ${String(exception)}`;
      stackTrace = "";
    }

    this.logger.error(errorMessage, stackTrace);

    // Slack으로 에러 알림 전송
    this.slackService
      .sendText(
        `*[CRITICAL ERROR]*\n${errorMessage}${stackTrace ? `\n\`\`\`${stackTrace}\`\`\`` : ""}`,
        { channel: "bug" },
      )
      .catch((err) => {
        this.logger.error("Failed to send Slack notification", err);
      });

    // 클라이언트에게는 안전한 메시지만 전달
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "An unexpected error occurred.",
    });
  }
}
