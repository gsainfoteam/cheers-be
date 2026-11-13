import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PageResponseDto } from "@src/cheers/dto/pagination.dto";
import {
  ApiAuth,
  ApiErrors,
  ApiPageResponse,
} from "@src/global/swagger/api-response.decorator";
import { AdminAuditLogService } from "@src/manager/audit/admin-audit-log.service";
import {
  AdminAuditLogDto,
  AdminAuditLogListQueryDto,
} from "@src/manager/audit/dto/admin-audit-log.dto";
import { ManagerGuard } from "@src/manager/guard/manager.guard";
import { SuperAdminGuard } from "@src/manager/guard/super-admin.guard";

@ApiTags("어드민 감사 로그")
@ApiAuth()
@Controller("/api/manager/v1/audit-log")
@UseGuards(ManagerGuard, SuperAdminGuard)
export class AdminAuditLogController {
  constructor(private readonly auditLogService: AdminAuditLogService) {}

  /** 어드민 감사 로그 목록 (최근 기록 순, superadmin 전용). 조회만 가능 */
  @Get()
  @ApiPageResponse(AdminAuditLogDto)
  @ApiErrors({
    400: "query 형식 오류, created_from이 created_to보다 늦음",
    403: "superadmin이 아님",
  })
  async list(
    @Query() query: AdminAuditLogListQueryDto,
  ): Promise<PageResponseDto<AdminAuditLogDto>> {
    return this.auditLogService.list(query);
  }
}
