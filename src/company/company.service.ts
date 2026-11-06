import { Injectable } from "@nestjs/common";
import { CompanyRepository } from "@src/database/repository/company.repository";
import { FileService } from "@src/file/file.service";
import { CompanySearchItemDto } from "./dto/company-search.dto";
import { COMPANY_SEARCH_LIMIT, normalizeCompanyName } from "./company.utils";

@Injectable()
export class CompanyService {
  constructor(
    private readonly companyRepository: CompanyRepository,
    private readonly fileService: FileService,
  ) {}

  // 현업자 프로필 입력창의 회사 검색. 어드민 확인 전 회사도 보여 줘서 같은 회사가 또 생기지 않게 함
  async search(q: string): Promise<CompanySearchItemDto[]> {
    const rows = await this.companyRepository.search(
      normalizeCompanyName(q),
      COMPANY_SEARCH_LIMIT,
    );
    const logoUrls = await this.fileService.getPresignedUrls(
      rows.map((row) => row.logoKey),
    );
    return rows.map((row) => ({
      company_id: row.pk,
      name: row.name,
      logo_url: row.logoKey ? (logoUrls.get(row.logoKey) ?? null) : null,
      matched_name: row.matchedName,
    }));
  }
}
