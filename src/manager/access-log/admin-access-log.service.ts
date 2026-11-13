import { BadRequestException, Injectable } from "@nestjs/common";
import {
  AdminAccessLogRepository,
  AdminAccessLogRow,
} from "@src/admin-repository/admin-access-log.repository";
import { toOffset } from "@src/cheers/cheers.utils";
import { PageResponseDto } from "@src/cheers/dto/pagination.dto";
import {
  AdminAccessLogDto,
  AdminAccessLogListQueryDto,
} from "@src/manager/access-log/dto/admin-access-log.dto";

@Injectable()
export class AdminAccessLogService {
  constructor(
    private readonly adminAccessLogRepository: AdminAccessLogRepository,
  ) {}

  async list(
    query: AdminAccessLogListQueryDto,
  ): Promise<PageResponseDto<AdminAccessLogDto>> {
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
    const { rows, total } = await this.adminAccessLogRepository.findPage(
      {
        adminEmail: query.admin_email,
        targetType: query.target_type,
        createdFrom,
        createdTo,
      },
      toOffset(page, size),
      size,
    );
    return { items: rows.map((row) => this.toDto(row)), page, size, total };
  }

  private toDto(row: AdminAccessLogRow): AdminAccessLogDto {
    return {
      pk: row.pk,
      admin_email: row.adminEmail,
      target_type: row.targetType,
      target_id: row.targetId,
      created_at: row.createdAt,
    };
  }
}
