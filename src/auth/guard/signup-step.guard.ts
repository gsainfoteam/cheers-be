import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthService } from "@src/auth/auth.service";
import { SignupStepService } from "@src/auth/signup-step.service";
import { SignupStep } from "@src/auth/decorator/signup-step.decorator";
import { authenticate } from "@src/auth/guard/access-token";

// 가입 단계 API: DB에서 계산한 next_step과 @SignupStep의 단계가 같을 때만 통과
@Injectable()
export class SignupStepGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
    private readonly signupStepService: SignupStepService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride(SignupStep, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) {
      throw new Error("SignupStepGuard requires @SignupStep()");
    }

    const user = await authenticate(context, this.authService);
    if (user.status === "active") {
      if (options.allowActive) return true;
      throw new ForbiddenException("Signup is already completed");
    }

    const nextStep = await this.signupStepService.getNextStep({
      pk: user.userPk,
      type: user.type,
      status: user.status,
    });
    if (nextStep !== options.step) {
      throw new ForbiddenException(
        `Signup step mismatch: expected ${nextStep}, got ${options.step}`,
      );
    }
    return true;
  }
}
