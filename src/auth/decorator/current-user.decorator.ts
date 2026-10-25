import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { UserContext } from "@src/auth/context/user-context";
import { AuthenticatedRequest } from "@src/auth/guard/access-token";

// 인증 가드가 담은 UserContext
export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): UserContext =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
