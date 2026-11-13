import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { adminAccessTargetType } from "@drizzle/schema/enums";
import { CreatedPeriodQueryDto } from "@src/manager/coffee-chat/dto/manager-coffee-chat.dto";

export type AdminAccessTargetType =
  (typeof adminAccessTargetType.enumValues)[number];

export class AdminAccessLogListQueryDto extends CreatedPeriodQueryDto {
  /** 어드민 이메일 (부분 일치, 대소문자 무시) */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  admin_email?: string;

  @ApiPropertyOptional({ enum: adminAccessTargetType.enumValues })
  @IsOptional()
  @IsIn(adminAccessTargetType.enumValues)
  target_type?: AdminAccessTargetType;
}

export class AdminAccessLogDto {
  pk: string;
  /** 열람 시점의 어드민 이메일 */
  admin_email: string;
  @ApiProperty({ enum: adminAccessTargetType.enumValues })
  target_type: AdminAccessTargetType;
  /** business_card: graduated.pk, dev_user_hard_delete: 지운 users.pk */
  target_id: string;
  created_at: Date;
}
