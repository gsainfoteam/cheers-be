import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "@src/database/database.service";
import {
  CoffeeChatRequestRepository,
  SentRequestRow,
} from "@src/database/repository/coffee-chat-request.repository";
import {
  GraduatedCardRepository,
  GraduatedRequestTarget,
} from "@src/database/repository/graduated-card.repository";
import { StudentRepository } from "@src/database/repository/student.repository";
import { buildCoffeeChatRequestedMail } from "@src/mail/templates/coffee-chat-requested.template";
import { NotificationService } from "@src/notification/notification.service";
import { NotifyInput } from "@src/notification/notification.types";
import {
  DEFAULT_RANDOM_SEED_MINUTES,
  GRADUATED_FALLBACK_NAME,
  WITHDRAWN_ACCOUNT_NAME,
} from "./cheers.constants";
import {
  randomSeed,
  resolveWebBaseUrl,
  toOffset,
  toRequestStatus,
} from "./cheers.utils";
import {
  CreateRequestDto,
  CreateRequestResponseDto,
} from "./dto/create-request.dto";
import { CheersCardDto, GraduatedListQueryDto } from "./dto/graduated-list.dto";
import { PageResponseDto, PaginationQueryDto } from "./dto/pagination.dto";
import { SentRequestDetailDto, SentRequestDto } from "./dto/sent-request.dto";

// API 명세 "커피챗 · 재학생" 섹션. 받은 요청 · 연락처 공유(현업자)는 CheersGraduatedService
@Injectable()
export class CheersStudentService {
  private readonly logger = new Logger(CheersStudentService.name);
  // 알림 메일의 요청 상세 링크 (끝의 / 제거). 로컬에서 비어 있으면 링크 없이 발송
  private readonly webBaseUrl: string | null;
  private readonly randomSeedMinutes: number;

  constructor(
    configService: ConfigService,
    private readonly dbService: DatabaseService,
    private readonly studentRepository: StudentRepository,
    private readonly graduatedCardRepository: GraduatedCardRepository,
    private readonly coffeeChatRequestRepository: CoffeeChatRequestRepository,
    private readonly notificationService: NotificationService,
  ) {
    this.webBaseUrl = resolveWebBaseUrl(configService, this.logger);

    // 빈 값은 미설정으로 봄
    const raw = configService.get<string>("CHEERS_RANDOM_SEED_MINUTES")?.trim();
    const minutes = raw ? Number(raw) : DEFAULT_RANDOM_SEED_MINUTES;
    if (!Number.isInteger(minutes) || minutes <= 0) {
      throw new Error(
        "CHEERS_RANDOM_SEED_MINUTES must be a positive integer (minutes).",
      );
    }
    this.randomSeedMinutes = minutes;
  }

  async getGraduatedList(
    query: GraduatedListQueryDto,
  ): Promise<PageResponseDto<CheersCardDto>> {
    const { rows, total } = await this.graduatedCardRepository.findPage({
      sort: query.sort,
      offset: toOffset(query.page, query.size),
      limit: query.size,
      // 같은 구간 안에서는 페이지를 넘겨도 random 순서가 유지됨
      seed: randomSeed(new Date(), this.randomSeedMinutes),
    });

    return {
      items: rows.map((row) => ({
        graduated_id: row.graduatedPk,
        nickname: row.nickname,
        company: row.company,
        job: row.job,
        hashtags: row.hashtags ?? [],
        links: row.links ?? [],
        last_active_at: row.lastActiveAt.toISOString(),
        can_request: row.canRequest,
      })),
      page: query.page,
      size: query.size,
      total,
    };
  }

  async createRequest(
    userPk: string,
    req: CreateRequestDto,
  ): Promise<CreateRequestResponseDto> {
    const { request, target } = await this.dbService.db.transaction(
      async (tx) => {
        const me = await this.studentRepository.findByUserPkWithLatestProfile(
          userPk,
          tx,
        );
        // active 재학생은 추가 정보가 항상 있음 (방어 코드)
        if (!me?.latest) {
          throw new ForbiddenException("Student profile not found");
        }

        const graduated = await this.graduatedCardRepository.findRequestTarget(
          req.graduated_id,
          tx,
        );
        if (!graduated) {
          throw new NotFoundException("Graduated not found");
        }
        if (
          !graduated.contact ||
          (!graduated.contact.emailEnabled && !graduated.contact.kakaoEnabled)
        ) {
          throw new ConflictException(
            "Graduated does not accept coffee chat requests",
          );
        }

        // 요청 당시의 재학생 정보 버전 (현재 = 가장 큰 version)
        const inserted = await this.coffeeChatRequestRepository.insert(
          {
            graduatedPk: graduated.graduatedPk,
            studentPk: me.student.pk,
            studentProfilePk: me.latest.profile.pk,
            message: req.message,
          },
          tx,
        );
        return { request: inserted, target: graduated };
      },
    );

    // notification_log가 coffee_chat_request를 참조하므로 커밋 뒤에 호출
    this.notificationService.notifyAsync(
      this.buildRequestedNotification(request.pk, target),
    );

    return { id: request.pk, created_at: request.createdAt.toISOString() };
  }

  async getSentList(
    userPk: string,
    query: PaginationQueryDto,
  ): Promise<PageResponseDto<SentRequestDto>> {
    const { rows, total } = await this.coffeeChatRequestRepository.findSentPage(
      userPk,
      toOffset(query.page, query.size),
      query.size,
    );

    return {
      items: rows.map((row) => this.toSentRequestDto(row)),
      page: query.page,
      size: query.size,
      total,
    };
  }

  async getSentDetail(
    userPk: string,
    requestPk: string,
  ): Promise<SentRequestDetailDto> {
    const row = await this.dbService.db.transaction(async (tx) => {
      const found = await this.coffeeChatRequestRepository.findSentByPk(
        requestPk,
        userPk,
        tx,
      );
      if (!found) {
        throw new NotFoundException("Coffee chat request not found");
      }

      // 공유받은 연락처를 처음 확인한 시각
      if (found.contactSharedAt && !found.studentViewedAt) {
        await this.coffeeChatRequestRepository.markStudentViewed(found.pk, tx);
      }
      return found;
    });

    return {
      ...this.toSentRequestDto(row),
      shared_contact: row.contactSharedAt
        ? {
            // 탈퇴 처리 후에는 이름이 지워지고, 유예기간 중에는 다른 회원에게 보이지 않아야 함
            name: row.graduatedActive
              ? (row.graduatedName ?? GRADUATED_FALLBACK_NAME)
              : WITHDRAWN_ACCOUNT_NAME,
            email: row.sharedEmail,
            phone: row.sharedPhone,
            shared_at: row.contactSharedAt.toISOString(),
          }
        : null,
    };
  }

  private toSentRequestDto(row: SentRequestRow): SentRequestDto {
    return {
      id: row.pk,
      graduated: {
        graduated_id: row.graduated.graduatedPk,
        nickname: row.graduated.nickname,
        company: row.graduated.company,
        job: row.graduated.job,
      },
      message: row.message ?? "",
      status: toRequestStatus(row),
      created_at: row.createdAt.toISOString(),
    };
  }

  // 현업자가 연락 설정에서 켠 채널만 담음
  private buildRequestedNotification(
    coffeeChatRequestPk: string,
    target: GraduatedRequestTarget,
  ): NotifyInput<"coffee_chat_requested"> {
    const contact = target.contact;
    const name = target.name ?? GRADUATED_FALLBACK_NAME;
    const link = this.webBaseUrl
      ? `${this.webBaseUrl}/cheers/received/${coffeeChatRequestPk}`
      : null;

    return {
      coffeeChatRequestPk,
      event: "coffee_chat_requested",
      email:
        contact?.emailEnabled && contact.email
          ? buildCoffeeChatRequestedMail(contact.email, name, link)
          : undefined,
      alimtalk:
        contact?.kakaoEnabled && contact.phone
          ? {
              to: contact.phone,
              variables: { recipientName: name, coffeeChatRequestPk },
            }
          : undefined,
    };
  }
}
