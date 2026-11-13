import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PageResponseDto } from "@src/cheers/dto/pagination.dto";
import {
  ApiAuth,
  ApiErrors,
  ApiPageResponse,
} from "@src/global/swagger/api-response.decorator";
import { AdminAccessLogService } from "@src/manager/access-log/admin-access-log.service";
import {
  AdminAccessLogDto,
  AdminAccessLogListQueryDto,
} from "@src/manager/access-log/dto/admin-access-log.dto";
import { ManagerGuard } from "@src/manager/guard/manager.guard";
import { SuperAdminGuard } from "@src/manager/guard/super-admin.guard";

@ApiTags("어드민 접근 로그")
@ApiAuth()
@Controller("/api/manager/v1/access-log")
@UseGuards(ManagerGuard, SuperAdminGuard)
export class AdminAccessLogController {
  constructor(private readonly accessLogService: AdminAccessLogService) {}

  /** 개인정보 열람 · 개발용 회원 완전탈퇴 기록 목록 (최근 기록 순, superadmin 전용). 조회만 가능 */
  @Get()
  @ApiPageResponse(AdminAccessLogDto)
  @ApiErrors({
    400: "query 형식 오류, created_from이 created_to보다 늦음",
    403: "superadmin이 아님",
  })
  async list(
    @Query() query: AdminAccessLogListQueryDto,
  ): Promise<PageResponseDto<AdminAccessLogDto>> {
    return this.accessLogService.list(query);
  }
}
