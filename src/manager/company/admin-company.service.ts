import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AdminCompanyAliasRow,
  AdminCompanyRepository,
  AdminCompanyRow,
} from "@src/admin-repository/admin-company.repository";
import { PageResponseDto } from "@src/cheers/dto/pagination.dto";
import { toOffset } from "@src/cheers/cheers.utils";
import {
  normalizeCompanyName,
  toCompanyDisplayName,
} from "@src/company/company.utils";
import { DatabaseService } from "@src/database/database.service";
import { UploadUrlResponseDto } from "@src/file/dto/upload-url.dto";
import { FilePurpose } from "@src/file/file.constants";
import { FileService } from "@src/file/file.service";
import { TxType } from "@src/global/types/tx.types";
import {
  AdminCompanyDto,
  AdminCompanyListQueryDto,
  CreateAdminCompanyRequestDto,
  UpdateAdminCompanyRequestDto,
} from "./dto/admin-company.dto";

const NOT_FOUND = "Company not found";

// 회사(alias) · 표기(name) 관리. 한 표기(normalized)는 한 회사에만 속함 (company_name.normalized_name UNIQUE)
// 회사 이름도 표기에 들어 있어야 검색됨 (검색은 company_name 만 봄)
@Injectable()
export class AdminCompanyService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly adminCompanyRepository: AdminCompanyRepository,
    private readonly fileService: FileService,
  ) {}

  async list(
    query: AdminCompanyListQueryDto,
  ): Promise<PageResponseDto<AdminCompanyDto>> {
    const { rows, total } = await this.adminCompanyRepository.findPage(
      { q: query.q ? normalizeCompanyName(query.q) : undefined },
      toOffset(query.page, query.size),
      query.size,
    );
    return {
      items: await this.toDtos(rows),
      page: query.page,
      size: query.size,
      total,
    };
  }

  // 미리 등록. 어드민이 만든 회사는 바로 확인된 상태
  async create(req: CreateAdminCompanyRequestDto): Promise<AdminCompanyDto> {
    const name = toCompanyDisplayName(req.name);
    const names = this.distinctNames([name, ...(req.names ?? [])]);

    const pk = await this.dbService.db.transaction(async (tx) => {
      await this.assertNamesAvailable(names, tx);
      const alias = await this.adminCompanyRepository.insertAlias(name, tx);
      await this.adminCompanyRepository.insertNames(alias.pk, names, tx);
      return alias.pk;
    });
    return this.getDto(pk);
  }

  // 이름 변경 · 승인(needs_review = false)
  async update(
    pk: number,
    req: UpdateAdminCompanyRequestDto,
  ): Promise<AdminCompanyDto> {
    await this.dbService.db.transaction(async (tx) => {
      await this.lockCompany(pk, tx);
      let name: string | undefined;
      if (req.name !== undefined) {
        name = toCompanyDisplayName(req.name);
        const [entry] = this.distinctNames([name]);
        await this.adminCompanyRepository.lockNames([entry.normalizedName], tx);
        const [registered] =
          await this.adminCompanyRepository.findNamesByNormalized(
            [entry.normalizedName],
            tx,
          );
        if (registered && registered.aliasPk !== pk) {
          throw new ConflictException(
            `Company name already registered: ${registered.name} (${registered.aliasName})`,
          );
        }
        // 새 이름도 검색되도록 표기에 추가. 예전 이름 표기는 남김
        if (!registered) {
          await this.adminCompanyRepository.insertNames(pk, [entry], tx);
        }
      }
      await this.adminCompanyRepository.updateAlias(
        pk,
        { name, needsReview: req.needs_review },
        tx,
      );
    });
    return this.getDto(pk);
  }

  async addName(pk: number, rawName: string): Promise<AdminCompanyDto> {
    const names = this.distinctNames([toCompanyDisplayName(rawName)]);
    await this.dbService.db.transaction(async (tx) => {
      await this.lockCompany(pk, tx);
      await this.assertNamesAvailable(names, tx);
      await this.adminCompanyRepository.insertNames(pk, names, tx);
    });
    return this.getDto(pk);
  }

  async removeName(pk: number, namePk: number): Promise<AdminCompanyDto> {
    await this.dbService.db.transaction(async (tx) => {
      const alias = await this.lockCompany(pk, tx);
      const name = await this.adminCompanyRepository.findName(pk, namePk, tx);
      if (!name) {
        throw new NotFoundException("Company name not found");
      }
      // 회사 이름 표기를 지우면 회사 이름으로 검색되지 않음
      if (name.normalizedName === normalizeCompanyName(alias.name)) {
        throw new BadRequestException("Cannot delete the company's own name");
      }
      await this.adminCompanyRepository.deleteName(namePk, tx);
    });
    return this.getDto(pk);
  }

  // sourcePk의 표기 · 현업자를 targetPk로 옮기고 sourcePk를 지움. target의 needs_review는 그대로
  async merge(sourcePk: number, targetPk: number): Promise<AdminCompanyDto> {
    if (sourcePk === targetPk) {
      throw new BadRequestException("Cannot merge a company into itself");
    }

    const orphanLogoKey = await this.dbService.db.transaction(async (tx) => {
      const rows = await this.adminCompanyRepository.findByPksForUpdate(
        [sourcePk, targetPk],
        tx,
      );
      const source = rows.find((row) => row.pk === sourcePk);
      const target = rows.find((row) => row.pk === targetPk);
      if (!source || !target) {
        throw new NotFoundException(NOT_FOUND);
      }

      await this.adminCompanyRepository.moveNames(sourcePk, targetPk, tx);
      await this.adminCompanyRepository.moveProfiles(sourcePk, targetPk, tx);
      // target에 로고가 없으면 원본 로고를 넘겨받음
      const inheritLogo = !target.logoKey && source.logoKey !== null;
      if (inheritLogo) {
        await this.adminCompanyRepository.updateAlias(
          targetPk,
          { logoKey: source.logoKey },
          tx,
        );
      }
      await this.adminCompanyRepository.deleteAlias(sourcePk, tx);
      return inheritLogo ? null : source.logoKey;
    });

    // 커밋 뒤에 지움. 실패해도 OrphanFileService가 나중에 정리
    if (orphanLogoKey) {
      await this.fileService.deleteFileQuietly(orphanLogoKey);
    }
    return this.getDto(targetPk);
  }

  // 현업자가 고른 회사는 지울 수 없음 (병합으로 처리)
  async remove(pk: number): Promise<void> {
    const logoKey = await this.dbService.db.transaction(async (tx) => {
      const alias = await this.lockCompany(pk, tx);
      if ((await this.adminCompanyRepository.countProfiles(pk, tx)) > 0) {
        throw new ConflictException(
          "Company in use. Merge it into another company instead",
        );
      }
      await this.adminCompanyRepository.deleteAlias(pk, tx);
      return alias.logoKey;
    });

    if (logoKey) {
      await this.fileService.deleteFileQuietly(logoKey);
    }
  }

  async createLogoUploadUrl(
    managerPk: string,
    contentType: string,
    size: number,
  ): Promise<UploadUrlResponseDto> {
    const { url, key, headers, expiresIn } =
      await this.fileService.createUploadUrl(
        managerPk,
        FilePurpose.COMPANY_LOGO,
        contentType,
        size,
      );
    return { url, method: "PUT", key, headers, expires_in: expiresIn };
  }

  // 업로드한 로고를 확정하고 연결. 이전 로고는 커밋 뒤에 지움
  async updateLogo(
    pk: number,
    tempKey: string,
    managerPk: string,
  ): Promise<void> {
    // S3 확인 · 이동은 트랜잭션 밖에서 먼저 해서 DB 잠금을 오래 잡지 않음
    // 트랜잭션이 실패해도 확정한 새 파일은 지우지 않음 (커밋 직후 연결이 끊긴 경우 대비). OrphanFileService가 정리
    const key = await this.fileService.confirmUpload(
      managerPk,
      FilePurpose.COMPANY_LOGO,
      tempKey,
    );

    const previousKey = await this.dbService.db.transaction(async (tx) => {
      const alias = await this.lockCompany(pk, tx);
      await this.adminCompanyRepository.updateAlias(pk, { logoKey: key }, tx);
      return alias.logoKey;
    });

    if (previousKey && previousKey !== key) {
      await this.fileService.deleteFileQuietly(previousKey);
    }
  }

  // 병합 · 삭제 · 동시 수정과 직렬화
  private async lockCompany(
    pk: number,
    tx: TxType,
  ): Promise<AdminCompanyAliasRow> {
    const alias = await this.adminCompanyRepository.findByPkForUpdate(pk, tx);
    if (!alias) {
      throw new NotFoundException(NOT_FOUND);
    }
    return alias;
  }

  // 같은 표기가 다른 회사(또는 이 회사)에 이미 있으면 409. 현업자 입력과 같은 표기 잠금을 먼저 잡음
  private async assertNamesAvailable(
    names: { name: string; normalizedName: string }[],
    tx: TxType,
  ): Promise<void> {
    const normalized = names.map((n) => n.normalizedName);
    await this.adminCompanyRepository.lockNames(normalized, tx);
    const registered = await this.adminCompanyRepository.findNamesByNormalized(
      normalized,
      tx,
    );
    if (registered.length > 0) {
      throw new ConflictException(
        `Company name already registered: ${registered
          .map((r) => `${r.name} (${r.aliasName})`)
          .join(", ")}`,
      );
    }
  }

  // 정규화가 같은 표기는 처음 것만 남김
  private distinctNames(
    names: string[],
  ): { name: string; normalizedName: string }[] {
    const seen = new Map<string, string>();
    for (const raw of names) {
      const name = toCompanyDisplayName(raw);
      const normalized = normalizeCompanyName(name);
      if (!seen.has(normalized)) seen.set(normalized, name);
    }
    return [...seen].map(([normalizedName, name]) => ({
      name,
      normalizedName,
    }));
  }

  private async getDto(pk: number): Promise<AdminCompanyDto> {
    const row = await this.adminCompanyRepository.findDetail(pk);
    if (!row) {
      // 응답을 만드는 사이 다른 어드민이 병합 · 삭제
      throw new NotFoundException(NOT_FOUND);
    }
    const [dto] = await this.toDtos([row]);
    return dto;
  }

  private async toDtos(rows: AdminCompanyRow[]): Promise<AdminCompanyDto[]> {
    const logoUrls = await this.fileService.getPresignedUrls(
      rows.map((row) => row.logoKey),
    );
    return rows.map((row) => ({
      company_id: row.pk,
      name: row.name,
      logo_url: row.logoKey ? (logoUrls.get(row.logoKey) ?? null) : null,
      needs_review: row.needsReview,
      names: row.names.map((n) => ({ name_id: n.pk, name: n.name })),
      graduated_count: row.graduatedCount,
      created_at: row.createdAt.toISOString(),
    }));
  }
}
