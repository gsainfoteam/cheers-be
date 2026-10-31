import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsIn, IsOptional, MaxLength } from "class-validator";
import { AdminAccountRole } from "@src/database/repository/admin-account.repository";

export const ADMIN_ACCOUNT_ROLES = ["admin", "superadmin"] as const;

export class AdminAccountDto {
  pk: string;
  email: string;

  @ApiProperty({ enum: ADMIN_ACCOUNT_ROLES })
  role: AdminAccountRole;

  created_at: Date;
  updated_at: Date;
}

export class CreateAdminAccountRequestDto {
  /** @gm.gist.ac.kr 이메일 */
  @IsEmail()
  @MaxLength(64)
  email: string;

  /** 비우면 admin */
  @ApiProperty({ enum: ADMIN_ACCOUNT_ROLES, required: false })
  @IsOptional()
  @IsIn(ADMIN_ACCOUNT_ROLES)
  role?: AdminAccountRole;
}

export class UpdateAdminAccountRoleRequestDto {
  @ApiProperty({ enum: ADMIN_ACCOUNT_ROLES })
  @IsIn(ADMIN_ACCOUNT_ROLES)
  role: AdminAccountRole;
}
