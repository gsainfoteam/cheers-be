import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AdminAuditLogRepository } from "@src/admin-repository/admin-audit-log.repository";
import {
  AdminConsentRepository,
  ConsentRow,
} from "@src/admin-repository/admin-consent.repository";
import { DatabaseService } from "@src/database/database.service";
import { ManagerContext } from "@src/manager/context/manager-context";
import {
  ConsentStatusDto,
  ConsentTypeDto,
  ConsentVersionDto,
  ConsentVersionListItemDto,
  CreateConsentVersionRequestDto,
} from "@src/manager/consent/dto/manager-consent.dto";

@Injectable()
export class ManagerConsentService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly adminConsentRepository: AdminConsentRepository,
    private readonly adminAuditLogRepository: AdminAuditLogRepository,
  ) {}

  // 레포지토리가 type, 최신 버전 순으로 주므로 순서를 유지한 채 묶음
  async list(): Promise<ConsentTypeDto[]> {
    const rows = await this.adminConsentRepository.findAllVersions();

    const grouped = new Map<string, ConsentVersionListItemDto[]>();
    for (const row of rows) {
      const versions = grouped.get(row.type) ?? [];
      versions.push({ ...this.toDto(row), is_latest: row.isLatest });
      grouped.set(row.type, versions);
    }
    return [...grouped].map(([type, versions]) => ({ type, versions }));
  }

  // 등록 전 확인은 어드민 화면에서 함.
  // 감사 로그(CRB-81)를 등록과 같은 트랜잭션에서 남김. 기록이 실패하면 등록도 되돌림
  async create(
    req: CreateConsentVersionRequestDto,
    manager: ManagerContext,
  ): Promise<ConsentVersionDto> {
    return this.dbService.db.transaction(async (tx) => {
      const row = await this.adminConsentRepository.insertIfAbsent(
        {
          type: req.type,
          version: req.version,
          isRequired: req.is_required,
          url: req.url,
        },
        tx,
      );
      if (!row) {
        throw new ConflictException("This consent version already exists.");
      }
      await this.adminAuditLogRepository.insert(
        {
          adminEmail: manager.email,
          action: "consent.create",
          targetType: "consent",
          // (type, version)이 복합 키라 "type:version"으로 이음. target_id 길이(64)를 넘으면 자름 (전체 값은 after에 있음)
          targetId: `${row.type}:${row.version}`.slice(0, 64),
          after: {
            type: row.type,
            version: row.version,
            is_required: row.isRequired,
            url: row.url,
          },
        },
        tx,
      );
      return this.toDto(row);
    });
  }

  async getStatus(type: string, version: string): Promise<ConsentStatusDto> {
    if (!(await this.adminConsentRepository.exists(type, version))) {
      throw new NotFoundException("Consent version not found.");
    }

    const counts = await this.adminConsentRepository.countStatus(type, version);
    return {
      type,
      version,
      agreed_count: counts.agreed,
      revoked_count: counts.revoked,
      withdrawn_count: counts.withdrawn,
    };
  }

  private toDto(row: ConsentRow): ConsentVersionDto {
    return {
      type: row.type,
      version: row.version,
      is_required: row.isRequired,
      url: row.url,
      created_at: row.createdAt,
    };
  }
}
