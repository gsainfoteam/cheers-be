import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AdminAccessLogRepository } from "@src/admin-repository/admin-access-log.repository";
import { AdminAuditLogRepository } from "@src/admin-repository/admin-audit-log.repository";
import {
  AdminDevUserRepository,
  AdminDevUserRow,
} from "@src/admin-repository/admin-dev-user.repository";
import {
  PageResponseDto,
  PaginationQueryDto,
} from "@src/cheers/dto/pagination.dto";
import { toOffset } from "@src/cheers/cheers.utils";
import { DatabaseService } from "@src/database/database.service";
import { FileService } from "@src/file/file.service";
import { ManagerContext } from "@src/manager/context/manager-context";
import { DevUserDto, DevUserStatus } from "./dto/dev-user.dto";

// 개발 · QA용 회원 완전탈퇴 (CRB-72). 탈퇴 유예기간 없이 지워서 같은 계정으로 바로 다시 가입해 볼 수 있게 함.
// DEV_USER_DELETE_ENABLED=true인 환경(staging)에서만 열림 (DevUserDeleteEnabledGuard)
@Injectable()
export class DevUserService {
  private readonly logger = new Logger(DevUserService.name);

  constructor(
    private readonly dbService: DatabaseService,
    private readonly fileService: FileService,
    private readonly adminDevUserRepository: AdminDevUserRepository,
    private readonly adminAccessLogRepository: AdminAccessLogRepository,
    private readonly adminAuditLogRepository: AdminAuditLogRepository,
  ) {}

  async list(query: PaginationQueryDto): Promise<PageResponseDto<DevUserDto>> {
    const { rows, total } = await this.adminDevUserRepository.findPage(
      toOffset(query.page, query.size),
      query.size,
    );
    return {
      items: rows.map((row) => this.toDto(row)),
      page: query.page,
      size: query.size,
      total,
    };
  }

  // 삭제와 접근 로그 · 감사 로그를 한 트랜잭션에서 처리 (기록 저장이 실패하면 지우지 않음).
  // S3 파일은 탈퇴 만료 처리(WithdrawalService)처럼 커밋 뒤에 지우고, 실패해도 DB에 참조가 없어 고아 파일 정리가 지움
  async delete(userPk: string, manager: ManagerContext): Promise<void> {
    const fileKeys = await this.dbService.db.transaction(async (tx) => {
      const deleted = await this.adminDevUserRepository.hardDelete(userPk, tx);
      if (!deleted) {
        throw new NotFoundException("User not found");
      }
      await this.adminAccessLogRepository.insert(
        {
          adminEmail: manager.email,
          targetType: "dev_user_hard_delete",
          targetId: userPk,
        },
        tx,
      );
      // 감사 로그(CRB-81): 개발용 API라 이름 · 이메일까지 지운 유저 행을 그대로 남김
      await this.adminAuditLogRepository.insert(
        {
          adminEmail: manager.email,
          action: "dev_user.hard_delete",
          targetType: "user",
          targetId: userPk,
          before: {
            type: deleted.user.type,
            status: deleted.user.status,
            is_deleted: deleted.user.isDeleted,
            withdraw_requested_at: deleted.user.withdrawRequestedAt,
            name: deleted.user.name,
            email: deleted.user.email,
            created_at: deleted.user.createdAt,
            student_pks: deleted.studentPks,
            graduated_pks: deleted.graduatedPks,
          },
        },
        tx,
      );
      return deleted.fileKeys;
    });

    await Promise.all(
      fileKeys.map((key) => this.fileService.deleteFileQuietly(key)),
    );
    this.logger.log(
      `Dev user hard deleted: user ${userPk}, manager ${manager.pk}, files ${fileKeys.length}`,
    );
  }

  private toDto(row: AdminDevUserRow): DevUserDto {
    return {
      user_pk: row.pk,
      type: row.type,
      status: this.toStatus(row),
      name: row.name,
      email: row.email,
      created_at: row.createdAt,
    };
  }

  private toStatus(row: AdminDevUserRow): DevUserStatus {
    if (row.isDeleted) return "withdrawn";
    if (row.withdrawRequestedAt) return "withdrawal_requested";
    return row.status;
  }
}
