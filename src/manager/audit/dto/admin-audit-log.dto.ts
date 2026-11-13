import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
  AdminAuditAction,
  AdminAuditSnapshot,
  AdminAuditTargetType,
} from "@drizzle/schema/admin-audit-log";
import { CreatedPeriodQueryDto } from "@src/manager/coffee-chat/dto/manager-coffee-chat.dto";

export class AdminAuditLogListQueryDto extends CreatedPeriodQueryDto {
  /** 어드민 이메일 (부분 일치, 대소문자 무시) */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  admin_email?: string;

  @ApiPropertyOptional({ enum: ADMIN_AUDIT_ACTIONS })
  @IsOptional()
  @IsIn(ADMIN_AUDIT_ACTIONS)
  action?: AdminAuditAction;

  @ApiPropertyOptional({ enum: ADMIN_AUDIT_TARGET_TYPES })
  @IsOptional()
  @IsIn(ADMIN_AUDIT_TARGET_TYPES)
  target_type?: AdminAuditTargetType;

  /** 대상 엔티티 pk (정확히 일치) */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  target_id?: string;
}

export class AdminAuditLogDto {
  pk: string;
  /** 요청 시점의 어드민 이메일 */
  admin_email: string;
  @ApiProperty({ enum: ADMIN_AUDIT_ACTIONS })
  action: AdminAuditAction;
  @ApiProperty({ enum: ADMIN_AUDIT_TARGET_TYPES })
  target_type: AdminAuditTargetType;
  /** 대상 엔티티 pk. 일괄 작업은 null */
  target_id: string | null;
  /** 변경 전 값. 생성이면 null */
  @ApiProperty({ type: "object", additionalProperties: true, nullable: true })
  before: AdminAuditSnapshot | null;
  /** 변경 후 값. 삭제면 null */
  @ApiProperty({ type: "object", additionalProperties: true, nullable: true })
  after: AdminAuditSnapshot | null;
  created_at: Date;
}
