import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ApiAuth, ApiErrors } from "@src/global/swagger/api-response.decorator";
import {
  DashboardRangeQueryDto,
  ManagerDashboardCoffeeChatDto,
  ManagerDashboardDemandDto,
  ManagerDashboardMemberDto,
  ManagerDashboardTodoDto,
} from "@src/manager/dashboard/dto/manager-dashboard.dto";
import { ManagerDashboardService } from "@src/manager/dashboard/manager-dashboard.service";
import { ManagerGuard } from "@src/manager/guard/manager.guard";

// 어드민 홈 대시보드. 읽기 전용이고 개인정보가 없어 access-log를 남기지 않음
@ApiTags("어드민 대시보드")
@ApiAuth()
@Controller("/api/manager/v1/dashboard")
@UseGuards(ManagerGuard)
export class ManagerDashboardController {
  constructor(private readonly dashboardService: ManagerDashboardService) {}

  /** 커피챗 요청 퍼널과 최근 6개월 월별 추이 */
  @Get("/coffee-chat")
  @ApiErrors({ 400: "range 형식 오류" })
  async getCoffeeChat(
    @Query() query: DashboardRangeQueryDto,
  ): Promise<ManagerDashboardCoffeeChatDto> {
    return this.dashboardService.getCoffeeChat(query.range);
  }

  /** 회원 현황 */
  @Get("/member")
  @ApiErrors({ 400: "range 형식 오류" })
  async getMember(
    @Query() query: DashboardRangeQueryDto,
  ): Promise<ManagerDashboardMemberDto> {
    return this.dashboardService.getMember(query.range);
  }

  /** 수요 분석 (학과 · 회사 · 관심 분야 TOP 5) */
  @Get("/demand")
  @ApiErrors({ 400: "range 형식 오류" })
  async getDemand(
    @Query() query: DashboardRangeQueryDto,
  ): Promise<ManagerDashboardDemandDto> {
    return this.dashboardService.getDemand(query.range);
  }

  /** 처리할 일과 알림 상태 */
  @Get("/todo")
  async getTodo(): Promise<ManagerDashboardTodoDto> {
    return this.dashboardService.getTodo();
  }
}
