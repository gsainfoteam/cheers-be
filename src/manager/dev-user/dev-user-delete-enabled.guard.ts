import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { isDevUserDeleteEnabled } from "./dev-user.config";

// ManagerGuard보다 앞에 붙임. 꺼져 있으면 토큰과 상관없이 없는 경로와 같은 404를 돌려줌
@Injectable()
export class DevUserDeleteEnabledGuard implements CanActivate {
  private readonly enabled: boolean;

  constructor(configService: ConfigService) {
    this.enabled = isDevUserDeleteEnabled(configService);
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.enabled) {
      const { method, originalUrl } = context
        .switchToHttp()
        .getRequest<Request>();
      throw new NotFoundException(`Cannot ${method} ${originalUrl}`);
    }
    return true;
  }
}
