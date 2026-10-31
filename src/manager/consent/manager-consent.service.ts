import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AdminConsentRepository } from "@src/admin-repository/admin-consent.repository";
import {
  ConsentStatusDto,
  ConsentTypeDto,
  ConsentVersionDto,
  CreateConsentVersionRequestDto,
} from "@src/manager/consent/dto/manager-consent.dto";

@Injectable()
export class ManagerConsentService {
  constructor(
    private readonly adminConsentRepository: AdminConsentRepository,
  ) {}

  // 레포지토리가 type, 최신 버전 순으로 주므로 순서를 유지한 채 묶음
  async list(): Promise<ConsentTypeDto[]> {
    const rows = await this.adminConsentRepository.findAllVersions();

    const grouped = new Map<string, ConsentVersionDto[]>();
    for (const row of rows) {
      const versions = grouped.get(row.type) ?? [];
      versions.push({
        type: row.type,
        version: row.version,
        is_required: row.isRequired,
        url: row.url,
        created_at: row.createdAt,
        is_latest: row.isLatest,
      });
      grouped.set(row.type, versions);
    }
    return [...grouped].map(([type, versions]) => ({ type, versions }));
  }

  // 등록 전 확인은 어드민 화면에서 함. 방금 넣은 행은 created_at이 가장 크므로 최신 버전
  async create(
    req: CreateConsentVersionRequestDto,
  ): Promise<ConsentVersionDto> {
    const row = await this.adminConsentRepository.insertIfAbsent({
      type: req.type,
      version: req.version,
      isRequired: req.is_required,
      url: req.url,
    });
    if (!row) {
      throw new ConflictException("This consent version already exists.");
    }
    return {
      type: row.type,
      version: row.version,
      is_required: row.isRequired,
      url: row.url,
      created_at: row.createdAt,
      is_latest: true,
    };
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
}
