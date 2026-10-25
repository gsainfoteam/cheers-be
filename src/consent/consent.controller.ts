import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { UserContext } from "@src/auth/context/user-context";
import { CurrentUser } from "@src/auth/decorator/current-user.decorator";
import { SignupStep } from "@src/auth/decorator/signup-step.decorator";
import { AnyStatusGuard } from "@src/auth/guard/any-status.guard";
import { SignupStepGuard } from "@src/auth/guard/signup-step.guard";
import { BaseResultDto } from "@src/global/dto/base-result.dto";
import { ConsentService } from "./consent.service";
import { ConsentListResponseDto } from "./dto/consent-list.dto";
import { UpdateConsentRequestDto } from "./dto/update-consent.dto";

@Controller("/api/v1/user/consent")
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  @Get("/list")
  @UseGuards(AnyStatusGuard)
  async getList(
    @CurrentUser() user: UserContext,
  ): Promise<ConsentListResponseDto> {
    return this.consentService.getList(user.userPk);
  }

  @Post()
  @UseGuards(SignupStepGuard)
  @SignupStep({ step: "consent", allowActive: true })
  async updateConsents(
    @Body() req: UpdateConsentRequestDto,
    @CurrentUser() user: UserContext,
  ): Promise<BaseResultDto> {
    return this.consentService.updateConsents(user.userPk, req);
  }
}
