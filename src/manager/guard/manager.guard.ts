import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { extractBearerToken } from "@src/auth/guard/access-token";
import { AdminAccountRepository } from "@src/database/repository/admin-account.repository";
import { ManagerContext } from "@src/manager/context/manager-context";
import { ManagerAuthService } from "@src/manager/manager-auth.service";

export type ManagerRequest = Request & { manager: ManagerContext };

// 모든 매니저 API. 토큰 수명이 1일이라 계정 삭제 · 권한 변경을 바로 반영하려고 요청마다 DB를 봄
@Injectable()
export class ManagerGuard implements CanActivate {
  constructor(
    private readonly managerAuthService: ManagerAuthService,
    private readonly adminAccountRepository: AdminAccountRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ManagerRequest>();
    const payload = await this.managerAuthService.verifyAccessToken(
      extractBearerToken(request),
    );

    const account = await this.adminAccountRepository.findByPk(payload.sub);
    if (!account) {
      throw new UnauthorizedException("Manager not found");
    }

    request.manager = new ManagerContext(
      account.pk,
      account.email,
      account.role,
    );
    return true;
  }
}
