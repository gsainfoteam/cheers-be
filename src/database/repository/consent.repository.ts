import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import {
  hasValidAgreement,
  isLatestConsent,
} from "@src/database/repository/consent.sql";

export type LatestConsent = {
  type: string;
  version: string;
  isRequired: boolean;
  url: string;
  // 이 버전에 유효한 동의(revoked_at IS NULL)가 있음
  agreed: boolean;
};

// 최신 버전 · 유효한 동의 판정은 UserRepository.findSignupProgress와 같은 조각(consent.sql.ts)을 씀
@Injectable()
export class ConsentRepository {
  constructor(private readonly dbService: DatabaseService) {}

  // type별 최신 버전과 내 동의 여부
  async findLatestWithAgreement(
    userPk: string,
    tx?: TxType,
  ): Promise<LatestConsent[]> {
    const result = await (tx ?? this.dbService.db).execute<{
      type: string;
      version: string;
      is_required: boolean;
      url: string;
      agreed: boolean;
    }>(sql`
      SELECT c.type, c.version, c.is_required, c.url,
        ${hasValidAgreement(userPk)} AS agreed
      FROM consent c
      WHERE ${isLatestConsent}
      ORDER BY c.type
    `);

    return result.rows.map((row) => ({
      type: row.type,
      version: row.version,
      isRequired: row.is_required,
      url: row.url,
      agreed: row.agreed,
    }));
  }
}
