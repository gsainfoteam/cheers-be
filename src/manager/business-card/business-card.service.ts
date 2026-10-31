import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { AdminAccessLogRepository } from "@src/admin-repository/admin-access-log.repository";
import {
  AdminGraduatedRepository,
  AdminGraduatedRow,
} from "@src/admin-repository/admin-graduated.repository";
import {
  PageResponseDto,
  PaginationQueryDto,
} from "@src/cheers/dto/pagination.dto";
import { toOffset } from "@src/cheers/cheers.utils";
import { DatabaseService } from "@src/database/database.service";
import { FileService } from "@src/file/file.service";
import { ManagerContext } from "@src/manager/context/manager-context";
import {
  BusinessCardGraduatedDto,
  BusinessCardImageUrlDto,
} from "./dto/business-card.dto";

// 화면에서 바로 여는 URL이라 짧게 둠. 앱 API의 기본값(S3_PRESIGNED_URL_EXPIRES_IN)을 따르지 않음
const IMAGE_URL_EXPIRES_IN = 60;

@Injectable()
export class BusinessCardService {
  private readonly logger = new Logger(BusinessCardService.name);

  constructor(
    private readonly dbService: DatabaseService,
    private readonly fileService: FileService,
    private readonly adminGraduatedRepository: AdminGraduatedRepository,
    private readonly adminAccessLogRepository: AdminAccessLogRepository,
  ) {}

  async list(
    query: PaginationQueryDto,
  ): Promise<PageResponseDto<BusinessCardGraduatedDto>> {
    const { rows, total } = await this.adminGraduatedRepository.findPage(
      toOffset(query.page, query.size),
      query.size,
    );
    return {
      items: rows.map((row) => this.toDto(row)),
      page: query.page,
      size: query.size,
      total,
    };
  }

  // 열람 기록을 먼저 남김. 저장에 실패하면 예외가 그대로 올라가 URL을 발급하지 않음
  async getImageUrl(
    graduatedPk: string,
    manager: ManagerContext,
  ): Promise<BusinessCardImageUrlDto> {
    const card = await this.adminGraduatedRepository.findCardByPk(graduatedPk);
    if (!card) {
      throw new NotFoundException("Graduated not found");
    }
    if (!card.businessCardKey) {
      throw new NotFoundException("Business card not found");
    }

    await this.adminAccessLogRepository.insert({
      adminEmail: manager.email,
      targetType: "business_card",
      targetId: graduatedPk,
    });

    return {
      url: await this.fileService.getPresignedUrl(
        card.businessCardKey,
        IMAGE_URL_EXPIRES_IN,
      ),
      expires_in: IMAGE_URL_EXPIRES_IN,
    };
  }

  // users.status는 그대로 둠: pending으로 되돌리면 재업로드 뒤 가입을 끝낼 길이 없고, 미완료 가입 정리가 계정을 지움.
  // 재학생 쪽 노출과 받은 요청 처리는 verified_at으로 막음 (GraduatedCardRepository, CheersGraduatedService).
  // S3 파일은 참조만 없애고 OrphanFileService에 맡김
  async cancelVerification(
    graduatedPk: string,
    manager: ManagerContext,
  ): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      const target = await this.adminGraduatedRepository.findForUpdate(
        graduatedPk,
        tx,
      );
      if (!target) {
        throw new NotFoundException("Graduated not found");
      }
      if (!target.verifiedAt) {
        throw new ConflictException("Business card is not verified");
      }
      await this.adminGraduatedRepository.clearVerification(graduatedPk, tx);
    });
    this.logger.log(
      `Business card verification canceled: graduated ${graduatedPk}, manager ${manager.pk}`,
    );
  }

  private toDto(row: AdminGraduatedRow): BusinessCardGraduatedDto {
    return {
      graduated_pk: row.graduatedPk,
      name: row.name,
      nickname: row.nickname,
      company: row.company,
      job: row.job,
      has_business_card: row.hasBusinessCard,
      verified_at: row.verifiedAt,
      signup_status: row.withdrawRequestedAt
        ? "withdrawal_requested"
        : row.status,
    };
  }
}
