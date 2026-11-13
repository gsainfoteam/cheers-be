import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AdminCoffeeChatRequestRepository,
  AdminCoffeeChatRequestRow,
} from "@src/admin-repository/admin-coffee-chat-request.repository";
import { AdminAuditLogRepository } from "@src/admin-repository/admin-audit-log.repository";
import {
  AdminNotificationLogRepository,
  AdminNotificationLogRow,
} from "@src/admin-repository/admin-notification-log.repository";
import { toOffset, toRequestStatus } from "@src/cheers/cheers.utils";
import { DatabaseService } from "@src/database/database.service";
import { ManagerContext } from "@src/manager/context/manager-context";
import { PageResponseDto } from "@src/cheers/dto/pagination.dto";
import {
  CoffeeChatRequestDetailDto,
  CoffeeChatRequestDto,
  CoffeeChatRequestListQueryDto,
  CreatedPeriodQueryDto,
  NotificationDeliveryLookupDto,
  NotificationLogDto,
  NotificationLogItemDto,
  NotificationLogListQueryDto,
} from "@src/manager/coffee-chat/dto/manager-coffee-chat.dto";
import { NotificationDeliverySyncService } from "@src/notification/notification-delivery-sync.service";
import { maskPersonalInfo } from "@src/notification/notification.utils";

@Injectable()
export class ManagerCoffeeChatService {
  constructor(
    private readonly requestRepository: AdminCoffeeChatRequestRepository,
    private readonly notificationLogRepository: AdminNotificationLogRepository,
    private readonly deliverySyncService: NotificationDeliverySyncService,
    private readonly dbService: DatabaseService,
    private readonly adminAuditLogRepository: AdminAuditLogRepository,
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
        deliveryStatus: query.delivery_status,
      },
      toOffset(page, size),
      size,
    );

    return {
      items: rows.map((row) => this.toLogItemDto(row)),
      page,
      size,
      total,
    };
  }

  // 알리고 접수에 성공한 알림톡의 카카오 결과를 지금 조회 (CRB-77). 결과가 나왔으면 저장
  async lookupDelivery(
    pk: string,
    manager: ManagerContext,
  ): Promise<NotificationDeliveryLookupDto> {
    const log = await this.notificationLogRepository.findByPk(pk);
    if (!log) {
      throw new NotFoundException("Notification log not found.");
    }
    if (
      log.channel !== "kakao_alimtalk" ||
      log.status !== "sent" ||
      !log.providerMessageId
    ) {
      throw new BadRequestException(
        "Only alimtalk accepted by Aligo has a delivery result.",
      );
    }

    const delivery = await this.deliverySyncService.refresh(
      log.pk,
      log.providerMessageId,
    );
    if (delivery.status === "error") {
      throw new BadGatewayException(
        `Failed to fetch the result from Aligo: ${maskPersonalInfo(delivery.error, log.recipient)}`,
      );
    }

    const updated = (await this.notificationLogRepository.findByPk(pk)) ?? log;
    await this.recordDeliveryLookup(manager, log, updated);
    return { lookup: delivery.status, log: this.toLogItemDto(updated) };
  }

  // 감사 로그(CRB-81): 조회 결과가 저장돼 카카오 결과 컬럼이 바뀐 경우만 남김.
  // 저장은 스케줄러와 같이 쓰는 NotificationDeliverySyncService가 먼저 커밋하므로, 이 기록만 별도 트랜잭션 (실패하면 요청이 500)
  private async recordDeliveryLookup(
    manager: ManagerContext,
    before: AdminNotificationLogRow,
    after: AdminNotificationLogRow,
  ): Promise<void> {
    const beforeSnapshot = this.toDeliverySnapshot(before);
    const afterSnapshot = this.toDeliverySnapshot(after);
    if (JSON.stringify(beforeSnapshot) === JSON.stringify(afterSnapshot)) {
      return;
    }
    await this.dbService.db.transaction((tx) =>
      this.adminAuditLogRepository.insert(
        {
          adminEmail: manager.email,
          action: "notification_log.delivery_lookup",
          targetType: "notification_log",
          targetId: after.pk,
          before: beforeSnapshot,
          after: afterSnapshot,
        },
        tx,
      ),
    );
  }

  // 메시지는 응답과 같이 수신자 정보를 가림
  private toDeliverySnapshot(row: AdminNotificationLogRow) {
    return {
      delivery_status: row.deliveryStatus,
      delivery_code: row.deliveryCode,
      delivery_message:
        row.deliveryMessage &&
        maskPersonalInfo(row.deliveryMessage, row.recipient),
      delivery_reported_at: row.deliveryReportedAt,
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

  private toLogItemDto(row: AdminNotificationLogRow): NotificationLogItemDto {
    return {
      ...this.toLogDto(row),
      coffee_chat_request_pk: row.coffeeChatRequestPk,
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
      provider_message_id: row.providerMessageId,
      delivery_status: row.deliveryStatus,
      delivery_code: row.deliveryCode,
      delivery_message:
        row.deliveryMessage &&
        maskPersonalInfo(row.deliveryMessage, row.recipient),
      delivery_reported_at: row.deliveryReportedAt,
      attempt: row.attempt,
      next_retry_at: row.nextRetryAt,
      created_at: row.createdAt,
    };
  }
}
