import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { AuthService } from "@src/auth/auth.service";
import { authenticate } from "@src/auth/guard/access-token";

// 내 정보 조회, 로그아웃, 약관 목록: 가입 상태와 관계없이 통과
@Injectable()
export class AnyStatusGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await authenticate(context, this.authService);
    return true;
  }
}
