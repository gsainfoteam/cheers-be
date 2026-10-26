import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "@src/auth/decorator/current-user.decorator";
import { UserContext } from "@src/auth/context/user-context";
import { AnyStatusGuard } from "@src/auth/guard/any-status.guard";
import { BaseResultDto } from "@src/global/dto/base-result.dto";
import { LoginRequestDto, LoginResponseDto } from "@src/user/dto/login.dto";
import { LogoutRequestDto } from "@src/user/dto/logout.dto";
import {
  RefreshRequestDto,
  RefreshResponseDto,
} from "@src/user/dto/refresh.dto";
import { UserInfoDto } from "@src/user/dto/user-info.dto";
import { UserService } from "@src/user/user.service";
import { WithdrawalService } from "@src/user/withdrawal.service";

// API 명세 "내 정보" 섹션. 약관 · 재학생 · 현업자 섹션은 각자 컨트롤러로 분리
@Controller("/api/v1/user")
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly withdrawalService: WithdrawalService,
  ) {}

  @Post("/oauth/login")
  async login(@Body() req: LoginRequestDto): Promise<LoginResponseDto> {
    return this.userService.login(req);
  }

  @Post("/refresh")
  async refresh(@Body() req: RefreshRequestDto): Promise<RefreshResponseDto> {
    return this.userService.refresh(req);
  }

  @Get("/info")
  @UseGuards(AnyStatusGuard)
  async getInfo(@CurrentUser() userCtx: UserContext): Promise<UserInfoDto> {
    return this.userService.getInfo(userCtx);
  }

  @Post("/logout")
  @UseGuards(AnyStatusGuard)
  async logout(
    @Body() req: LogoutRequestDto,
    @CurrentUser() userCtx: UserContext,
  ): Promise<BaseResultDto> {
    return this.userService.logout(req, userCtx);
  }

  // 가입 중 이탈한 유저도 직접 탈퇴할 수 있도록 상태와 무관하게 허용.
  // 바로 지우지 않고 유예기간 뒤 스케줄러가 삭제 (WithdrawalService)
  @Post("/withdraw")
  @UseGuards(AnyStatusGuard)
  async withdraw(@CurrentUser() userCtx: UserContext): Promise<BaseResultDto> {
    return this.withdrawalService.request(userCtx);
  }
}
