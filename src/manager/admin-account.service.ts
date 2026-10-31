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
    private readonly adminAccountRepository: AdminAccountRepository,
  ) {}

  async list(): Promise<AdminAccountDto[]> {
    const accounts = await this.adminAccountRepository.findAll();
    return accounts.map((account) => this.toDto(account));
  }

  async create(req: CreateAdminAccountRequestDto): Promise<AdminAccountDto> {
    const email = normalizeEmail(req.email);
    if (!email.endsWith(MANAGER_EMAIL_DOMAIN)) {
      throw new BadRequestException(
        "Only gm.gist.ac.kr emails can be registered.",
      );
    }

    const account = await this.adminAccountRepository.insertIfAbsent({
      email,
      role: req.role ?? "admin",
    });
    if (!account) {
      throw new ConflictException("This admin email is already registered.");
    }
    return this.toDto(account);
  }

  // 자기 자신은 바꿀 수 없어 호출자가 superadmin으로 남으므로 superadmin이 0명이 되지 않음
  async updateRole(
    pk: string,
    req: UpdateAdminAccountRoleRequestDto,
    manager: ManagerContext,
  ): Promise<AdminAccountDto> {
    const target = await this.findTarget(pk);
    if (target.pk === manager.pk) {
      throw new ForbiddenException("You cannot change your own role.");
    }

    const updated = await this.adminAccountRepository.updateRole(pk, req.role);
    if (!updated) {
      throw new NotFoundException("Admin account not found.");
    }
    return this.toDto(updated);
  }

  async remove(pk: string, manager: ManagerContext): Promise<void> {
    const target = await this.findTarget(pk);
    if (target.pk === manager.pk) {
      throw new ForbiddenException("You cannot remove yourself.");
    }
    if (target.role === "superadmin") {
      throw new ForbiddenException(SUPERADMIN_NOT_REMOVABLE);
    }

    // 확인과 삭제 사이에 승격돼도 지우지 않도록 삭제 쿼리에 role 조건이 있음
    const deleted = await this.adminAccountRepository.deleteAdminByPk(pk);
    if (!deleted) {
      throw new ForbiddenException(SUPERADMIN_NOT_REMOVABLE);
    }
  }

  private async findTarget(pk: string): Promise<AdminAccountRow> {
    const target = await this.adminAccountRepository.findByPk(pk);
    if (!target) {
      throw new NotFoundException("Admin account not found.");
    }
    return target;
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
