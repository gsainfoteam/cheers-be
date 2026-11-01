import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AdminCoffeeChatRequestRepository,
  AdminCoffeeChatRequestRow,
} from "@src/admin-repository/admin-coffee-chat-request.repository";
import {
  AdminNotificationLogRepository,
  AdminNotificationLogRow,
} from "@src/admin-repository/admin-notification-log.repository";
import { toOffset, toRequestStatus } from "@src/cheers/cheers.utils";
import { PageResponseDto } from "@src/cheers/dto/pagination.dto";
import {
  CoffeeChatRequestDetailDto,
  CoffeeChatRequestDto,
  CoffeeChatRequestListQueryDto,
  CreatedPeriodQueryDto,
  NotificationLogDto,
  NotificationLogItemDto,
  NotificationLogListQueryDto,
} from "@src/manager/coffee-chat/dto/manager-coffee-chat.dto";
import { maskPersonalInfo } from "@src/notification/notification.utils";

@Injectable()
export class ManagerCoffeeChatService {
  constructor(
    private readonly requestRepository: AdminCoffeeChatRequestRepository,
    private readonly notificationLogRepository: AdminNotificationLogRepository,
  ) {}

  async listRequests(
    query: CoffeeChatRequestListQueryDto,
  ): Promise<PageResponseDto<CoffeeChatRequestDto>> {
    const { page, size } = query;
    const { rows, total } = await this.requestRepository.findPage(
      {
        ...this.toPeriod(query),
        status: query.status,
        studentPk: query.student_pk,
        studentName: query.student_name,
        graduatedPk: query.graduated_pk,
        graduatedNickname: query.graduated_nickname,
      },
      toOffset(page, size),
      size,
    );

    return {
      items: rows.map((row) => this.toRequestDto(row)),
      page,
      size,
      total,
    };
  }

  async getRequest(pk: string): Promise<CoffeeChatRequestDetailDto> {
    const request = await this.requestRepository.findByPk(pk);
    if (!request) {
      throw new NotFoundException("Coffee chat request not found.");
    }

    const logs = await this.notificationLogRepository.findByRequestPk(pk);
    return {
      ...this.toRequestDto(request),
      message: request.message,
      student_viewed_at: request.studentViewedAt,
      notifications: logs.map((log) => this.toLogDto(log)),
    };
  }

  async listNotificationLogs(
    query: NotificationLogListQueryDto,
  ): Promise<PageResponseDto<NotificationLogItemDto>> {
    const { page, size } = query;
    const { rows, total } = await this.notificationLogRepository.findPage(
      {
        ...this.toPeriod(query),
        channel: query.channel,
        status: query.status,
        event: query.event,
      },
      toOffset(page, size),
      size,
    );

    return {
      items: rows.map((row) => ({
        ...this.toLogDto(row),
        coffee_chat_request_pk: row.coffeeChatRequestPk,
      })),
      page,
      size,
      total,
    };
  }

  private toPeriod(query: CreatedPeriodQueryDto): {
    createdFrom?: Date;
    createdTo?: Date;
  } {
    const createdFrom = query.created_from
      ? new Date(query.created_from)
      : undefined;
    const createdTo = query.created_to ? new Date(query.created_to) : undefined;
    if (createdFrom && createdTo && createdFrom > createdTo) {
      throw new BadRequestException(
        "created_from must not be after created_to",
      );
    }
    return { createdFrom, createdTo };
  }

  private toRequestDto(row: AdminCoffeeChatRequestRow): CoffeeChatRequestDto {
    return {
      pk: row.pk,
      status: toRequestStatus(row),
      student: row.student,
      graduated: row.graduated,
      created_at: row.createdAt,
      graduated_viewed_at: row.graduatedViewedAt,
      contact_shared_at: row.contactSharedAt,
    };
  }

  // recipient는 응답하지 않음. 탈퇴 처리 후에도 원문이 남아 있어 error도 가림
  private toLogDto(row: AdminNotificationLogRow): NotificationLogDto {
    return {
      pk: row.pk,
      event: row.event,
      channel: row.channel,
      status: row.status,
      error: row.error && maskPersonalInfo(row.error, row.recipient),
      created_at: row.createdAt,
    };
  }
}
