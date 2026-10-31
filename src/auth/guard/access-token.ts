import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { AuthService } from "@src/auth/auth.service";
import { UserContext } from "@src/auth/context/user-context";

export type AuthenticatedRequest = Request & { user: UserContext };

// Authorization: Bearer 토큰 추출. 매니저 가드도 같이 씀
export function extractBearerToken(request: Request): string {
  // scheme은 대소문자 무관(RFC 7235), scheme과 토큰 사이 공백 여러 개 허용
  const match = /^Bearer\s+(\S+)\s*$/i.exec(
    request.headers.authorization ?? "",
  );
  if (!match) {
    throw new UnauthorizedException("Missing access token");
  }
  return match[1];
}

// Authorization: Bearer 토큰을 검증하고 request.user에 UserContext를 담음
export async function authenticate(
  context: ExecutionContext,
  authService: AuthService,
): Promise<UserContext> {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  const payload = await authService.verifyAccessToken(
    extractBearerToken(request),
  );
  request.user = new UserContext(payload.sub, payload.type, payload.status);
  return request.user;
}
