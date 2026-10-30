import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { UserContext } from "@src/auth/context/user-context";
import { CurrentUser } from "@src/auth/decorator/current-user.decorator";
import { SignupStep } from "@src/auth/decorator/signup-step.decorator";
import { UserTypes } from "@src/auth/decorator/user-types.decorator";
import { SignupStepGuard } from "@src/auth/guard/signup-step.guard";
import { UserTypeGuard } from "@src/auth/guard/user-type.guard";
import { ApiTags } from "@nestjs/swagger";
import { BaseResultDto } from "@src/global/dto/base-result.dto";
import { ApiAuth, ApiErrors } from "@src/global/swagger/api-response.decorator";
import { SignupCompleteResponseDto } from "@src/user/dto/signup-complete.dto";
import { GraduatedInfoRequestDto } from "./dto/graduated-info.dto";
import { VerifyBusinessCardRequestDto } from "./dto/verify-business-card.dto";
import { GraduatedService } from "./graduated.service";

// API 명세 "현업자" 섹션. 가입 단계 API이며 가입을 마친 뒤에도 마이페이지 수정용으로 호출
@ApiTags("현업자")
@ApiAuth()
@Controller("/api/v1/user/graduated")
@UseGuards(SignupStepGuard, UserTypeGuard)
@UserTypes(["graduated"])
export class GraduatedController {
  constructor(private readonly graduatedService: GraduatedService) {}

  /** 업로드한 명함 제출 (가입 후에는 교체) */
  @Post("/verify/business-card")
  @SignupStep({ step: "verify", allowActive: true })
  @ApiErrors({
    400: "요청 형식 오류, 내가 발급받은 key가 아님, 업로드되지 않음, 허용 범위를 벗어난 파일",
    403: "현업자가 아님, 가입 중인데 next_step이 verify가 아님",
  })
  async verifyBusinessCard(
    @Body() req: VerifyBusinessCardRequestDto,
    @CurrentUser() user: UserContext,
  ): Promise<BaseResultDto> {
    return this.graduatedService.verifyBusinessCard(user.userPk, req.key);
  }

  /** 현업자 추가 정보 저장 (가입 후에는 수정) */
  @Post("/info")
  @SignupStep({ step: "profile", allowActive: true })
  @ApiErrors({
    400: "요청 형식 오류, 연락처 누락, 이름 누락, 첫 저장인데 nickname 누락",
    403: "현업자가 아님, 가입 중인데 next_step이 profile이 아님",
  })
  async saveInfo(
    @Body() req: GraduatedInfoRequestDto,
    @CurrentUser() user: UserContext,
  ): Promise<SignupCompleteResponseDto> {
    return this.graduatedService.saveInfo(user.userPk, req);
  }
}
