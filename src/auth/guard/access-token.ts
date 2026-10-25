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
  const [scheme, token] = request.headers.authorization?.split(" ") ?? [];
  if (scheme !== "Bearer" || !token) {
    throw new UnauthorizedException("Missing access token");
  }

  const payload = await authService.verifyAccessToken(token);
  request.user = new UserContext(payload.sub, payload.type, payload.status);
  return request.user;
}
