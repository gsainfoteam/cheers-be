import { BadRequestException, Injectable } from "@nestjs/common";
import {
  AdminAuditLogRepository,
  AdminAuditLogRow,
} from "@src/admin-repository/admin-audit-log.repository";
import { toOffset } from "@src/cheers/cheers.utils";
import { PageResponseDto } from "@src/cheers/dto/pagination.dto";
import {
  AdminAuditLogDto,
  AdminAuditLogListQueryDto,
} from "@src/manager/audit/dto/admin-audit-log.dto";

@Injectable()
export class AdminAuditLogService {
  constructor(
    private readonly adminAuditLogRepository: AdminAuditLogRepository,
  ) {}

  async list(
    query: AdminAuditLogListQueryDto,
  ): Promise<PageResponseDto<AdminAuditLogDto>> {
    const createdFrom = query.created_from
      ? new Date(query.created_from)
      : undefined;
    const createdTo = query.created_to ? new Date(query.created_to) : undefined;
    if (createdFrom && createdTo && createdFrom > createdTo) {
      throw new BadRequestException(
        "created_from must not be after created_to",
      );
    }

    const { page, size } = query;
    const { rows, total } = await this.adminAuditLogRepository.findPage(
      {
        adminEmail: query.admin_email,
        action: query.action,
        targetType: query.target_type,
        targetId: query.target_id,
        createdFrom,
        createdTo,
      },
      toOffset(page, size),
      size,
    );
    return { items: rows.map((row) => this.toDto(row)), page, size, total };
  }

  private toDto(row: AdminAuditLogRow): AdminAuditLogDto {
    return {
      pk: row.pk,
      admin_email: row.adminEmail,
      action: row.action,
      target_type: row.targetType,
      target_id: row.targetId,
      before: row.before,
      after: row.after,
      created_at: row.createdAt,
    };
  }
}
