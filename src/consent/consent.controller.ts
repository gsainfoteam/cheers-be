import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { UserContext } from "@src/auth/context/user-context";
import { CurrentUser } from "@src/auth/decorator/current-user.decorator";
import { SignupStep } from "@src/auth/decorator/signup-step.decorator";
import { AnyStatusGuard } from "@src/auth/guard/any-status.guard";
import { SignupStepGuard } from "@src/auth/guard/signup-step.guard";
import { ApiTags } from "@nestjs/swagger";
import { BaseResultDto } from "@src/global/dto/base-result.dto";
import { ApiAuth, ApiErrors } from "@src/global/swagger/api-response.decorator";
import { ConsentService } from "./consent.service";
import { ConsentListResponseDto } from "./dto/consent-list.dto";
import { UpdateConsentRequestDto } from "./dto/update-consent.dto";

@ApiTags("이용약관")
@ApiAuth()
@Controller("/api/v1/user/consent")
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  /** 이용약관 목록과 내 동의 여부 */
  @Get("/list")
  @UseGuards(AnyStatusGuard)
  async getList(
    @CurrentUser() user: UserContext,
  ): Promise<ConsentListResponseDto> {
    return this.consentService.getList(user.userPk);
  }

  /** 이용약관 동의 저장 */
  @Post()
  @UseGuards(SignupStepGuard)
  @SignupStep({ step: "consent", allowActive: true })
  @ApiErrors({
    400: "요청 형식 오류, 중복 · 잘못된 약관, 필수 약관 미동의",
    403: "가입 중인데 next_step이 consent가 아님",
  })
  async updateConsents(
    @Body() req: UpdateConsentRequestDto,
    @CurrentUser() user: UserContext,
  ): Promise<BaseResultDto> {
    return this.consentService.updateConsents(user.userPk, req);
  }
}
