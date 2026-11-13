import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AdminAccountRepository,
  AdminAccountRow,
} from "@src/admin-repository/admin-account.repository";
import { AdminAuditLogRepository } from "@src/admin-repository/admin-audit-log.repository";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { AdminAuditSnapshot } from "@drizzle/schema/admin-audit-log";
import { ManagerContext } from "@src/manager/context/manager-context";
import {
  AdminAccountDto,
  CreateAdminAccountRequestDto,
  UpdateAdminAccountRoleRequestDto,
} from "@src/manager/dto/admin-account.dto";
import {
  MANAGER_EMAIL_DOMAIN,
  normalizeEmail,
} from "@src/manager/manager-email";

const SUPERADMIN_NOT_REMOVABLE =
  "Superadmin accounts cannot be removed. Demote to admin first.";

@Injectable()
export class AdminAccountService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly adminAccountRepository: AdminAccountRepository,
    private readonly adminAuditLogRepository: AdminAuditLogRepository,
  ) {}

  async list(): Promise<AdminAccountDto[]> {
    const accounts = await this.adminAccountRepository.findAll();
    return accounts.map((account) => this.toDto(account));
  }

  // 등록 · 권한 변경 · 삭제는 감사 로그(CRB-81)를 변경과 같은 트랜잭션에서 남김. 기록이 실패하면 변경도 되돌림
  async create(
    req: CreateAdminAccountRequestDto,
    manager: ManagerContext,
  ): Promise<AdminAccountDto> {
    const email = normalizeEmail(req.email);
    if (!email.endsWith(MANAGER_EMAIL_DOMAIN)) {
      throw new BadRequestException(
        "Only gm.gist.ac.kr emails can be registered.",
      );
    }

    return this.dbService.db.transaction(async (tx) => {
      const account = await this.adminAccountRepository.insertIfAbsent(
        { email, role: req.role ?? "admin" },
        tx,
      );
      if (!account) {
        throw new ConflictException("This admin email is already registered.");
      }
      await this.adminAuditLogRepository.insert(
        {
          adminEmail: manager.email,
          action: "admin_account.create",
          targetType: "admin_account",
          targetId: account.pk,
          after: this.toSnapshot(account),
        },
        tx,
      );
      return this.toDto(account);
    });
  }

  // 자기 자신은 바꿀 수 없어 호출자가 superadmin으로 남으므로 superadmin이 0명이 되지 않음
  async updateRole(
    pk: string,
    req: UpdateAdminAccountRoleRequestDto,
    manager: ManagerContext,
  ): Promise<AdminAccountDto> {
    return this.dbService.db.transaction(async (tx) => {
      const target = await this.findTarget(pk, tx);
      if (target.pk === manager.pk) {
        throw new ForbiddenException("You cannot change your own role.");
      }

      const updated = await this.adminAccountRepository.updateRole(
        pk,
        req.role,
        tx,
      );
      if (!updated) {
        throw new NotFoundException("Admin account not found.");
      }
      await this.adminAuditLogRepository.insert(
        {
          adminEmail: manager.email,
          action: "admin_account.role_update",
          targetType: "admin_account",
          targetId: pk,
          before: this.toSnapshot(target),
          after: this.toSnapshot(updated),
        },
        tx,
      );
      return this.toDto(updated);
    });
  }

  async remove(pk: string, manager: ManagerContext): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      const target = await this.findTarget(pk, tx);
      if (target.pk === manager.pk) {
        throw new ForbiddenException("You cannot remove yourself.");
      }
      if (target.role === "superadmin") {
        throw new ForbiddenException(SUPERADMIN_NOT_REMOVABLE);
      }

      // 행을 잠근 채로 확인하지만, 삭제 쿼리에도 role 조건을 둠
      const deleted = await this.adminAccountRepository.deleteAdminByPk(pk, tx);
      if (!deleted) {
        throw new ForbiddenException(SUPERADMIN_NOT_REMOVABLE);
      }
      await this.adminAuditLogRepository.insert(
        {
          adminEmail: manager.email,
          action: "admin_account.delete",
          targetType: "admin_account",
          targetId: pk,
          before: this.toSnapshot(target),
        },
        tx,
      );
    });
  }

  private async findTarget(pk: string, tx: TxType): Promise<AdminAccountRow> {
    const target = await this.adminAccountRepository.findByPkForUpdate(pk, tx);
    if (!target) {
      throw new NotFoundException("Admin account not found.");
    }
    return target;
  }

  // 감사 로그용 스냅샷. 이메일 · 권한만 남김
  private toSnapshot(account: AdminAccountRow): AdminAuditSnapshot {
    return { email: account.email, role: account.role };
  }

  private toDto(account: AdminAccountRow): AdminAccountDto {
    return {
      pk: account.pk,
      email: account.email,
      role: account.role,
      created_at: account.createdAt,
      updated_at: account.updatedAt,
    };
  }
}
