import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from "class-validator";
import { PaginationQueryDto } from "@src/cheers/dto/pagination.dto";
import { CoffeeChatRequestStatus } from "@src/cheers/cheers.utils";
import {
  NotificationChannel,
  NotificationEvent,
  NotificationStatus,
} from "@src/notification/notification.types";
import {
  notificationChannel,
  notificationEvent,
  notificationStatus,
} from "@drizzle/schema/enums";

export const COFFEE_CHAT_REQUEST_STATUSES = [
  "requested",
  "viewed",
  "contact_shared",
] as const satisfies readonly CoffeeChatRequestStatus[];

// PostgreSQL은 text 파라미터에 NUL을 받지 않음
const toKeyword = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.replaceAll("\0", "").trim() : value;

// IsISO8601만으로는 오프셋이 없는 값(서버 시간대로 해석됨)과 Date로 읽지 못하는 값(20261015, 2026-W01)이 통과함
const OFFSET_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const OFFSET_DATE_TIME_MESSAGE =
  "$property must be an ISO 8601 date-time with a UTC offset";

// 기간 필터 공통. [created_from, created_to)
export class CreatedPeriodQueryDto extends PaginationQueryDto {
  /** 이 시각부터 (포함). UTC 오프셋이 있는 ISO 8601 */
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(OFFSET_DATE_TIME, { message: OFFSET_DATE_TIME_MESSAGE })
  created_from?: string;

  /** 이 시각 전까지 (미포함). UTC 오프셋이 있는 ISO 8601 */
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(OFFSET_DATE_TIME, { message: OFFSET_DATE_TIME_MESSAGE })
  created_to?: string;
}

export class CoffeeChatRequestListQueryDto extends CreatedPeriodQueryDto {
  @ApiPropertyOptional({ enum: COFFEE_CHAT_REQUEST_STATUSES })
  @IsOptional()
  @IsIn(COFFEE_CHAT_REQUEST_STATUSES)
  status?: CoffeeChatRequestStatus;

  /** 탈퇴 처리로 이름이 지워진 재학생은 이 값으로 찾음 */
  @IsOptional()
  @IsUUID()
  student_pk?: string;

  /** 재학생 이름 (부분 일치) */
  @IsOptional()
  @Transform(toKeyword)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  student_name?: string;

  @IsOptional()
  @IsUUID()
  graduated_pk?: string;

  /** 현업자 닉네임 (부분 일치) */
  @IsOptional()
  @Transform(toKeyword)
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  graduated_nickname?: string;
}

export class NotificationLogListQueryDto extends CreatedPeriodQueryDto {
  @ApiPropertyOptional({ enum: notificationChannel.enumValues })
  @IsOptional()
  @IsIn(notificationChannel.enumValues)
  channel?: NotificationChannel;

  @ApiPropertyOptional({ enum: notificationStatus.enumValues })
  @IsOptional()
  @IsIn(notificationStatus.enumValues)
  status?: NotificationStatus;

  @ApiPropertyOptional({ enum: notificationEvent.enumValues })
  @IsOptional()
  @IsIn(notificationEvent.enumValues)
  event?: NotificationEvent;
}

export class CoffeeChatRequestStudentDto {
  pk: string;
  /** 탈퇴 처리 후에는 null */
  name: string | null;
  /** 요청 당시 학과 */
  department: string;
  /** 탈퇴했거나 탈퇴 유예기간 중이면 false */
  active: boolean;
}

// 이름 · 회사 부서 · 연락처는 비공개라 포함하지 않음
export class CoffeeChatRequestGraduatedDto {
  pk: string;
  nickname: string;
  company: string;
  job: string;
  /** 탈퇴했거나 탈퇴 유예기간 중이면 false */
  active: boolean;
}

// 공유된 연락처(shared_email, shared_phone)는 넣지 않음. 공유 여부는 status와 contact_shared_at으로 봄
export class CoffeeChatRequestDto {
  pk: string;

  @ApiProperty({ enum: COFFEE_CHAT_REQUEST_STATUSES })
  status: CoffeeChatRequestStatus;

  student: CoffeeChatRequestStudentDto;
  graduated: CoffeeChatRequestGraduatedDto;
  created_at: Date;
  /** 현업자가 처음 열람한 시각 */
  graduated_viewed_at: Date | null;
  /** 현업자가 연락처를 공유한 시각 */
  contact_shared_at: Date | null;
}

// 수신자(recipient)는 넣지 않음
export class NotificationLogDto {
  pk: string;

  @ApiProperty({ enum: notificationEvent.enumValues })
  event: NotificationEvent;

  @ApiProperty({ enum: notificationChannel.enumValues })
  channel: NotificationChannel;

  @ApiProperty({ enum: notificationStatus.enumValues })
  status: NotificationStatus;

  /** 실패 사유. 이메일 · 전화번호는 가려서 내려줌 */
  error: string | null;
  created_at: Date;
}

export class NotificationLogItemDto extends NotificationLogDto {
  coffee_chat_request_pk: string;
}

export class CoffeeChatRequestDetailDto extends CoffeeChatRequestDto {
  /** 요청 메시지 */
  message: string | null;
  /** 재학생이 공유받은 연락처를 처음 확인한 시각 */
  student_viewed_at: Date | null;
  /** 이 요청의 알림 발송 결과 (최근 순) */
  notifications: NotificationLogDto[];
}
