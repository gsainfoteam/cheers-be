import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { UserContext } from "@src/auth/context/user-context";
import { CurrentUser } from "@src/auth/decorator/current-user.decorator";
import { SignupStep } from "@src/auth/decorator/signup-step.decorator";
import { UserTypes } from "@src/auth/decorator/user-types.decorator";
import { SignupStepGuard } from "@src/auth/guard/signup-step.guard";
import { UserTypeGuard } from "@src/auth/guard/user-type.guard";
import { BaseResultDto } from "@src/global/dto/base-result.dto";
import { SignupCompleteResponseDto } from "@src/user/dto/signup-complete.dto";
import { GraduatedInfoRequestDto } from "./dto/graduated-info.dto";
import { VerifyBusinessCardRequestDto } from "./dto/verify-business-card.dto";
import { GraduatedService } from "./graduated.service";

// API 명세 "현업자" 섹션. 가입 단계 API이며 가입을 마친 뒤에도 마이페이지 수정용으로 호출
@Controller("/api/v1/user/graduated")
@UseGuards(SignupStepGuard, UserTypeGuard)
@UserTypes(["graduated"])
export class GraduatedController {
  constructor(private readonly graduatedService: GraduatedService) {}

  @Post("/verify/business-card")
  @SignupStep({ step: "verify", allowActive: true })
  async verifyBusinessCard(
    @Body() req: VerifyBusinessCardRequestDto,
    @CurrentUser() user: UserContext,
  ): Promise<BaseResultDto> {
    return this.graduatedService.verifyBusinessCard(user.userPk, req.key);
  }

  @Post("/info")
  @SignupStep({ step: "profile", allowActive: true })
  async saveInfo(
    @Body() req: GraduatedInfoRequestDto,
    @CurrentUser() user: UserContext,
  ): Promise<SignupCompleteResponseDto> {
    return this.graduatedService.saveInfo(user.userPk, req);
  }
}
