import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, tap } from "rxjs";
import { Request } from "express";

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpLoggingInterceptor.name);

  /**
   * nginx proxy를 통해 전달된 실제 클라이언트 IP 주소를 추출합니다.
   * 우선순위: X-Forwarded-For > X-Real-IP > request.ip
   */
  private getClientIp(request: Request): string {
    // X-Forwarded-For 헤더 확인 (여러 프록시를 거쳤을 때 첫 번째가 실제 클라이언트 IP)
    const forwardedFor = request.headers["x-forwarded-for"];
    if (forwardedFor) {
      const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
      return ips.split(",")[0].trim();
    }

    // X-Real-IP 헤더 확인
    const realIp = request.headers["x-real-ip"];
    if (realIp) {
      return Array.isArray(realIp) ? realIp[0] : realIp;
    }

    // fallback: request.ip 사용
    return request.ip || "unknown";
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request: Request = context.switchToHttp().getRequest();
    const clientIp = this.getClientIp(request);
    const uri = request.url.split("?")[0];

    this.logger.log(
      `[Request][${
        request.method
      }][${uri}][IP: ${clientIp}] Request: ${JSON.stringify(
        request.method.toUpperCase() === "GET" ? request.query : request.body,
      )}`,
    );

    return next.handle().pipe(
      tap(async () => {
        const { statusCode } = context.switchToHttp().getResponse();

        let level = "Fail";
        if (statusCode >= 200 && statusCode < 300) {
          level = "Success";
        }

        this.logger.log(
          `[Response][${
            request.method
          }][${uri}][IP: ${clientIp}][${level}] (${statusCode})`,
        );
      }),
    );
  }
}
