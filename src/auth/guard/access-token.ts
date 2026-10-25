import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { AuthService } from "@src/auth/auth.service";
import { UserContext } from "@src/auth/context/user-context";

export type AuthenticatedRequest = Request & { user: UserContext };

// Authorization: Bearer 토큰을 검증하고 request.user에 UserContext를 담음
export async function authenticate(
  context: ExecutionContext,
  authService: AuthService,
): Promise<UserContext> {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  // scheme은 대소문자 무관(RFC 7235), scheme과 토큰 사이 공백 여러 개 허용
  const match = /^Bearer\s+(\S+)\s*$/i.exec(
    request.headers.authorization ?? "",
  );
  if (!match) {
    throw new UnauthorizedException("Missing access token");
  }

  const payload = await authService.verifyAccessToken(match[1]);
  request.user = new UserContext(payload.sub, payload.type, payload.status);
  return request.user;
}
