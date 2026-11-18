import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "@src/auth/decorator/current-user.decorator";
import { UserContext } from "@src/auth/context/user-context";
import { AnyStatusGuard } from "@src/auth/guard/any-status.guard";
import { ApiTags } from "@nestjs/swagger";
import { BaseResultDto } from "@src/global/dto/base-result.dto";
import { ApiAuth, ApiErrors } from "@src/global/swagger/api-response.decorator";
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
@ApiTags("내 정보")
@Controller("/api/v1/user")
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly withdrawalService: WithdrawalService,
  ) {}

  /** OAuth 로그인 (가입 전이어도 토큰 발급) */
  @Post("/oauth/login")
  @ApiErrors({
    400: "요청 형식 오류, 지원하지 않는 provider",
    401: "OAuth 토큰이 유효하지 않음",
    409: "같은 계정으로 동시에 최초 로그인 중",
  })
  async login(@Body() req: LoginRequestDto): Promise<LoginResponseDto> {
    return this.userService.login(req);
  }

  /** access token 갱신 (refresh token은 재발급 · 연장 없음. 발급 후 기본 180일이 지나면 다시 로그인) */
  @Post("/refresh")
  @ApiErrors({
    400: "요청 형식 오류",
    401: "refresh token이 유효하지 않거나 만료됨",
  })
  async refresh(@Body() req: RefreshRequestDto): Promise<RefreshResponseDto> {
    return this.userService.refresh(req);
  }

  /** 내 정보 조회 */
  @Get("/info")
  @UseGuards(AnyStatusGuard)
  @ApiAuth()
  async getInfo(@CurrentUser() userCtx: UserContext): Promise<UserInfoDto> {
    return this.userService.getInfo(userCtx);
  }

  /** 로그아웃 */
  @Post("/logout")
  @UseGuards(AnyStatusGuard)
  @ApiAuth()
  @ApiErrors({ 400: "요청 형식 오류" })
  async logout(
    @Body() req: LogoutRequestDto,
    @CurrentUser() userCtx: UserContext,
  ): Promise<BaseResultDto> {
    return this.userService.logout(req, userCtx);
  }

  /** 탈퇴 요청 (가입 완료 사용자는 즉시 삭제) */
  // 가입 중 유저의 기존 요청 경로는 호환을 위해 유지하며 1일 뒤 스케줄러가 삭제.
  // 가입 도중 이탈한 계정은 CleanupService가 24시간 뒤 별도로 정리.
  @Post("/withdraw")
  @UseGuards(AnyStatusGuard)
  @ApiAuth()
  async withdraw(@CurrentUser() userCtx: UserContext): Promise<BaseResultDto> {
    return this.withdrawalService.request(userCtx);
  }
}
