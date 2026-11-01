import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "@src/database/database.service";
import { CoffeeChatContactRepository } from "@src/database/repository/coffee-chat-contact.repository";
import {
  CoffeeChatRequestRepository,
  ReceivedRequestForShareRow,
} from "@src/database/repository/coffee-chat-request.repository";
import { GraduatedRepository } from "@src/database/repository/graduated.repository";
import { UserRepository } from "@src/database/repository/user.repository";
import { FileService } from "@src/file/file.service";
import { buildContactSharedMail } from "@src/mail/templates/contact-shared.template";
import { NotificationService } from "@src/notification/notification.service";
import { NotifyInput } from "@src/notification/notification.types";
import {
  GRADUATED_FALLBACK_NAME,
  STUDENT_FALLBACK_NAME,
  WITHDRAWN_STUDENT_REQUEST_LABEL,
} from "./cheers.constants";
import { resolveWebBaseUrl, toOffset, toRequestStatus } from "./cheers.utils";
import { PageResponseDto, PaginationQueryDto } from "./dto/pagination.dto";
import {
  ReceivedRequestDetailDto,
  ReceivedRequestDto,
  ShareContactResponseDto,
} from "./dto/received-request.dto";

// API 명세 "커피챗 · 현업자" 섹션
@Injectable()
export class CheersGraduatedService {
  private readonly logger = new Logger(CheersGraduatedService.name);
  private readonly webBaseUrl: string | null;

  constructor(
    configService: ConfigService,
    private readonly dbService: DatabaseService,
    private readonly coffeeChatRequestRepository: CoffeeChatRequestRepository,
    private readonly coffeeChatContactRepository: CoffeeChatContactRepository,
    private readonly userRepository: UserRepository,
    private readonly graduatedRepository: GraduatedRepository,
    private readonly fileService: FileService,
    private readonly notificationService: NotificationService,
  ) {
    this.webBaseUrl = resolveWebBaseUrl(configService, this.logger);
  }

  async getReceivedList(
    userPk: string,
    query: PaginationQueryDto,
  ): Promise<PageResponseDto<ReceivedRequestDto>> {
    await this.assertVerified(userPk);
    const { rows, total } =
      await this.coffeeChatRequestRepository.findReceivedPage(
        userPk,
        toOffset(query.page, query.size),
        query.size,
      );

    return {
      items: rows.map((row) => ({
        id: row.pk,
        // 탈퇴 처리 후에는 이름이 지워지고, 유예기간 중에는 다른 회원에게 보이지 않아야 함
        student_name: row.studentActive
          ? (row.studentName ?? STUDENT_FALLBACK_NAME)
          : WITHDRAWN_STUDENT_REQUEST_LABEL,
        department: row.departmentName,
        student_withdrawn: !row.studentActive,
        status: toRequestStatus(row),
        created_at: row.createdAt.toISOString(),
      })),
      page: query.page,
      size: query.size,
      total,
    };
  }

  async getReceivedDetail(
    userPk: string,
    requestPk: string,
  ): Promise<ReceivedRequestDetailDto> {
    await this.assertVerified(userPk);
    const row = await this.dbService.db.transaction(async (tx) => {
      const found = await this.coffeeChatRequestRepository.findReceivedByPk(
        requestPk,
        userPk,
        tx,
      );
      if (!found) {
        throw new NotFoundException("Coffee chat request not found");
      }
      // 목록 클릭은 프론트가 막지만 알림 링크로 바로 들어올 수 있음. 열람 기록도 남기지 않음
      if (!found.studentActive) {
        throw new GoneException("Student has withdrawn");
      }

      // 요청을 처음 확인한 시각
      if (!found.graduatedViewedAt) {
        await this.coffeeChatRequestRepository.markGraduatedViewed(
          found.pk,
          tx,
        );
      }
      return found;
    });

    // S3 서명은 커밋 뒤에 처리해 트랜잭션을 오래 잡지 않음
    const attachments = await Promise.all(
      row.attachments.map(async (attachment) => ({
        kind: attachment.kind,
        source: attachment.source,
        // file이면 비공개 버킷의 key라 presigned URL로 내려줌
        url:
          attachment.source === "file"
            ? await this.fileService.getPresignedUrl(attachment.url)
            : attachment.url,
        file_name: attachment.fileName,
      })),
    );
    const contact = row.studentContact;

    return {
      id: row.pk,
      message: row.message ?? "",
      // 이 호출로 확인 처리되므로 "requested"는 내려가지 않음
      status: row.contactSharedAt ? "contact_shared" : "viewed",
      created_at: row.createdAt.toISOString(),
      contact_shared_at: row.contactSharedAt?.toISOString() ?? null,
      student: {
        name: row.studentName ?? STUDENT_FALLBACK_NAME,
        department: row.departmentName,
        interests: row.interests,
        activities: row.activities ?? [],
        attachments,
        email: contact?.emailEnabled ? contact.email : null,
        phone: contact?.kakaoEnabled ? contact.phone : null,
      },
    };
  }

  async shareContact(
    userPk: string,
    requestPk: string,
  ): Promise<ShareContactResponseDto> {
    await this.assertVerified(userPk);
    // 내 데이터는 요청 행과 원자적으로 묶을 필요가 없어 밖에서 읽음 (행 잠금을 짧게 유지)
    const [contact, me] = await Promise.all([
      this.coffeeChatContactRepository.findByUserPk(userPk),
      this.userRepository.findByPk(userPk),
    ]);
    const sharedEmail = contact?.emailEnabled ? contact.email : null;
    const sharedPhone = contact?.kakaoEnabled ? contact.phone : null;

    const { response, notification } = await this.dbService.db.transaction(
      async (tx) => {
        const row = await this.coffeeChatRequestRepository.findReceivedForShare(
          requestPk,
          userPk,
          tx,
        );
        if (!row) {
          throw new NotFoundException("Coffee chat request not found");
        }
        // 처음 공유한 결과를 그대로 반환. 내 연락처만 담기므로 상대가 탈퇴했어도 같음
        if (row.contactSharedAt) {
          return {
            response: {
              contact_shared_at: row.contactSharedAt.toISOString(),
              shared_email: row.sharedEmail,
              shared_phone: row.sharedPhone,
            },
            notification: null,
          };
        }
        if (!row.studentActive) {
          throw new GoneException("Student has withdrawn");
        }
        if (!sharedEmail && !sharedPhone) {
          throw new ConflictException("No contact to share");
        }

        const contactSharedAt =
          await this.coffeeChatRequestRepository.markContactShared(
            row.pk,
            { sharedEmail, sharedPhone },
            tx,
          );
        return {
          response: {
            contact_shared_at: contactSharedAt.toISOString(),
            shared_email: sharedEmail,
            shared_phone: sharedPhone,
          },
          notification: this.buildSharedNotification(
            row,
            me?.name ?? GRADUATED_FALLBACK_NAME,
          ),
        };
      },
    );

    // notification_log가 coffee_chat_request를 참조하므로 커밋 뒤에 호출
    if (notification) {
      this.notificationService.notifyAsync(notification);
    }

    return response;
  }

  // 어드민이 명함 인증을 취소한 현업자는 재업로드 전까지 재학생 정보를 볼 수 없음. 토큰에 없는 값이라 DB에서 확인
  private async assertVerified(userPk: string): Promise<void> {
    const graduated = await this.graduatedRepository.findByUserPk(userPk);
    if (!graduated?.verifiedAt) {
      throw new ForbiddenException("Business card verification is required");
    }
  }

  // 재학생이 연락 설정에서 켠 채널만 담음
  private buildSharedNotification(
    row: ReceivedRequestForShareRow,
    graduatedName: string,
  ): NotifyInput<"contact_shared"> {
    const contact = row.studentContact;
    const recipientName = row.studentName ?? STUDENT_FALLBACK_NAME;
    const coffeeChatRequestPk = row.pk;
    const link = this.webBaseUrl
      ? `${this.webBaseUrl}/cheers/sent/${coffeeChatRequestPk}`
      : null;

    return {
      coffeeChatRequestPk,
      event: "contact_shared",
      email:
        contact?.emailEnabled && contact.email
          ? buildContactSharedMail(
              contact.email,
              recipientName,
              graduatedName,
              link,
            )
          : undefined,
      alimtalk:
        contact?.kakaoEnabled && contact.phone
          ? {
              to: contact.phone,
              variables: { recipientName, graduatedName, coffeeChatRequestPk },
            }
          : undefined,
    };
  }
}
