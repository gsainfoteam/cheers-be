import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ApiAuth, ApiErrors } from "@src/global/swagger/api-response.decorator";
import { ManagerContext } from "@src/manager/context/manager-context";
import { CurrentManager } from "@src/manager/decorator/current-manager.decorator";
import {
  ManagerLoginRequestDto,
  ManagerLoginResponseDto,
  ManagerMeResponseDto,
} from "@src/manager/dto/manager-auth.dto";
import { ManagerGuard } from "@src/manager/guard/manager.guard";
import { ManagerAuthService } from "@src/manager/manager-auth.service";

@ApiTags("매니저 인증")
@Controller("/api/manager/v1/auth")
export class ManagerAuthController {
  constructor(private readonly managerAuthService: ManagerAuthService) {}

  /** 어드민 로그인 (IdP code 교환 후 admin_account에 있는 이메일만 허용) */
  @Post("/login")
  @ApiErrors({
    400: "요청 형식 오류",
    401: "IdP가 code 또는 토큰을 거부함",
    403: "admin_account에 없는 이메일",
  })
  async login(
    @Body() req: ManagerLoginRequestDto,
  ): Promise<ManagerLoginResponseDto> {
    const accessToken = await this.managerAuthService.login(
      req.code,
      req.redirect_uri,
      req.code_verifier,
    );
    return { access_token: accessToken };
  }

  /** 현재 매니저 정보 */
  @Get("/me")
  @UseGuards(ManagerGuard)
  @ApiAuth()
  me(@CurrentManager() manager: ManagerContext): ManagerMeResponseDto {
    return { email: manager.email, role: manager.role };
  }
}
