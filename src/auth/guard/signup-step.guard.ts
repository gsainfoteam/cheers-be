import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthService } from "@src/auth/auth.service";
import { SignupStepService } from "@src/auth/signup-step.service";
import { SignupStep } from "@src/auth/decorator/signup-step.decorator";
import { UserContext } from "@src/auth/context/user-context";
import {
  AuthenticatedRequest,
  authenticate,
} from "@src/auth/guard/access-token";
import { UserRepository } from "@src/database/repository/user.repository";

// 가입 단계 API: DB에서 계산한 next_step과 @SignupStep의 단계가 같을 때만 통과.
// 토큰 클레임 대신 DB의 status · type을 쓰고 request.user도 DB 값으로 교체
@Injectable()
export class SignupStepGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
    private readonly signupStepService: SignupStepService,
    private readonly userRepository: UserRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride(SignupStep, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) {
      throw new Error("SignupStepGuard requires @SignupStep()");
    }

    const tokenUser = await authenticate(context, this.authService);

    // 가입 중에는 유형 변경 · 가입 완료로 토큰 클레임이 DB와 어긋날 수 있어 DB 기준으로 판단
    const user = await this.userRepository.findByPk(tokenUser.userPk);
    if (!user) {
      throw new UnauthorizedException("User not found");
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.user = new UserContext(user.pk, user.type, user.status);

    if (user.status === "active") {
      if (options.allowActive) return true;
      throw new ForbiddenException("Signup is already completed");
    }

    const nextStep = await this.signupStepService.getNextStep(user);
    if (nextStep !== options.step) {
      throw new ForbiddenException(
        `Signup step mismatch: expected ${nextStep}, got ${options.step}`,
      );
    }
    return true;
  }
}
