import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { AuthService } from "@src/auth/auth.service";
import { authenticate } from "@src/auth/guard/access-token";

// 일반 API: 가입을 마친(active) 유저만 통과
@Injectable()
export class UserGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = await authenticate(context, this.authService);
    if (user.status !== "active") {
      throw new ForbiddenException("Signup is not completed");
    }
    return true;
  }
}
