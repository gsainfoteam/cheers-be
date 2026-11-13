import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { AdminAuditLogRepository } from "@src/admin-repository/admin-audit-log.repository";
import { AdminCompanyRepository } from "@src/admin-repository/admin-company.repository";
import { normalizeCompanyName } from "@src/company/company.utils";
import { DatabaseService } from "@src/database/database.service";
import { ManagerContext } from "@src/manager/context/manager-context";
import {
  parseCompanyImport,
  CompanyImportFile,
  ImportRow,
} from "./company-import.parser";
import { planCompanyImport } from "./company-import.plan";
import { CompanyImportResultDto } from "./dto/company-import.dto";

@Injectable()
export class CompanyImportService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly repository: AdminCompanyRepository,
    private readonly adminAuditLogRepository: AdminAuditLogRepository,
  ) {}

  async preview(file: CompanyImportFile): Promise<CompanyImportResultDto> {
    const rows = await parseCompanyImport(file);
    return this.dbService.db.transaction(async (tx) =>
      planCompanyImport(
        rows,
        await this.repository.findNamesByNormalized(
          this.normalizedNames(rows),
          tx,
        ),
      ),
    );
  }

  // 감사 로그(CRB-81)는 저장과 같은 트랜잭션에서 요약만 남김 (파일 내용은 넣지 않음). 재시도하면 커밋된 시도의 것만 남음
  async commit(
    file: CompanyImportFile,
    manager: ManagerContext,
  ): Promise<CompanyImportResultDto> {
    const rows = await parseCompanyImport(file);
    const normalized = this.normalizedNames(rows);
    // 관리자의 수정 · 병합이나 현업자의 직접 입력과 경합하면 최신 상태로 전체를 재검증.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.dbService.db.transaction(
          async (tx) => {
            const before = await this.repository.findNamesByNormalized(
              normalized,
              tx,
            );
            const pks = [...new Set(before.map((n) => n.aliasPk))];
            // 기존 수정과 같은 순서: 회사 행 → 표기. 대상 전체를 먼저 잠금.
            if (pks.length) await this.repository.findByPksForUpdate(pks, tx);
            await this.repository.lockNames(normalized, tx);
            const registered = await this.repository.findNamesByNormalized(
              normalized,
              tx,
            );
            const result = planCompanyImport(rows, registered);
            if (!result.valid)
              throw new BadRequestException({
                message: "오류가 있는 행을 수정한 뒤 다시 업로드해 주세요.",
                preview: result,
              });
            const created = new Map<string, number>();
            for (const row of result.rows) {
              if (row.action === "skip") continue;
              const key = normalizeCompanyName(row.name);
              let pk = row.company_id ?? created.get(key);
              if (pk === undefined) {
                pk = (await this.repository.insertAlias(row.name, tx)).pk;
                created.set(key, pk);
              }
              await this.repository.insertNames(
                pk,
                row.added_names.map((name) => ({
                  name,
                  normalizedName: normalizeCompanyName(name),
                })),
                tx,
              );
            }
            await this.adminAuditLogRepository.insert(
              {
                adminEmail: manager.email,
                action: "company.import",
                targetType: "company",
                after: {
                  created_companies: result.created_companies,
                  updated_companies: result.updated_companies,
                  added_names: result.added_names,
                  skipped_rows: result.skipped_rows,
                },
              },
              tx,
            );
            return result;
          },
          { isolationLevel: "serializable" },
        );
      } catch (error) {
        const code =
          (error as { code?: string; cause?: { code?: string } })?.cause
            ?.code ?? (error as { code?: string })?.code;
        if (!["40001", "40P01", "23505"].includes(code ?? "")) throw error;
        if (attempt === 2)
          throw new ConflictException(
            "회사 목록이 변경되었습니다. 미리보기를 다시 확인해 주세요.",
          );
      }
    }
    throw new ConflictException("미리보기를 다시 확인해 주세요.");
  }

  private normalizedNames(rows: ImportRow[]): string[] {
    return [
      ...new Set(rows.flatMap((row) => row.names.map((n) => n.normalizedName))),
    ];
  }
}
