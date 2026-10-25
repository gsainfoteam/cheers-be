import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserTypes } from "@src/auth/decorator/user-types.decorator";
import { AuthenticatedRequest } from "@src/auth/guard/access-token";

// 재학생 / 현업자 유형 가드. 인증 가드 뒤에 사용: @UseGuards(UserGuard, UserTypeGuard)
@Injectable()
export class UserTypeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const types = this.reflector.getAllAndOverride(UserTypes, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!types) {
      throw new Error("UserTypeGuard requires @UserTypes()");
    }

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) {
      throw new Error(
        "UserTypeGuard must be used after an authentication guard",
      );
    }
    if (!types.includes(user.type)) {
      throw new ForbiddenException("User type not allowed");
    }
    return true;
  }
}
