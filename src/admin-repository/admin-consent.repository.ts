import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DatabaseService } from "@src/database/database.service";
import { isLatestConsent } from "@src/database/repository/consent.sql";
import { consent } from "@drizzle/schema/consent";

export type ConsentRow = typeof consent.$inferSelect;
export type ConsentVersionRow = ConsentRow & { isLatest: boolean };
export type ConsentStatusCounts = {
  agreed: number;
  revoked: number;
  withdrawn: number;
};

// isLatestConsent 조각이 consent의 별칭을 c로 가정함
const c = alias(consent, "c");

@Injectable()
export class AdminConsentRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT c.*, <isLatestConsent> AS is_latest FROM consent c
  ORDER BY c.type, c.created_at DESC, c.version DESC;
   */
  // 최신 버전 판정은 사용자 API와 같은 조각을 써서 답이 어긋나지 않게 함
  async findAllVersions(): Promise<ConsentVersionRow[]> {
    return this.dbService.db
      .select({
        type: c.type,
        version: c.version,
        isRequired: c.isRequired,
        createdAt: c.createdAt,
        url: c.url,
        isLatest: sql<boolean>`${isLatestConsent}`,
      })
      .from(c)
      .orderBy(asc(c.type), desc(c.createdAt), desc(c.version));
  }

  /*
  SELECT 1 FROM consent WHERE type = ?1 AND version = ?2;
   */
  async exists(type: string, version: string): Promise<boolean> {
    const result = await this.dbService.db
      .select({ type: consent.type })
      .from(consent)
      .where(and(eq(consent.type, type), eq(consent.version, version)));

    return result.length > 0;
  }

  /*
  INSERT INTO consent (type, version, is_required, url) VALUES (?1, ?2, ?3, ?4)
  ON CONFLICT (type, version) DO NOTHING RETURNING *;
   */
  // 이미 있는 버전이면 null. 최신 버전을 created_at으로 판정하므로 한 번에 한 행만 넣음
  async insertIfAbsent(
    row: Pick<ConsentRow, "type" | "version" | "isRequired" | "url">,
  ): Promise<ConsentRow | null> {
    const result = await this.dbService.db
      .insert(consent)
      .values(row)
      .onConflictDoNothing({ target: [consent.type, consent.version] })
      .returning();

    return result[0] ?? null;
  }

  // 철회 후 재동의하면 행이 여러 개라 사용자 단위로 셈. 세 값은 겹치지 않음
  // 탈퇴한 사용자의 동의 이력은 revoked_at 없이 남으므로 따로 셈
  async countStatus(
    type: string,
    version: string,
  ): Promise<ConsentStatusCounts> {
    const result = await this.dbService.db.execute<{
      agreed: number;
      revoked: number;
      withdrawn: number;
    }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE NOT t.is_deleted AND t.has_valid)::int AS agreed,
        COUNT(*) FILTER (WHERE NOT t.is_deleted AND NOT t.has_valid)::int AS revoked,
        COUNT(*) FILTER (WHERE t.is_deleted)::int AS withdrawn
      FROM (
        SELECT u.is_deleted, BOOL_OR(uc.revoked_at IS NULL) AS has_valid
        FROM user_consent uc
        JOIN users u ON u.pk = uc.user_pk
        WHERE uc.consent_type = ${type} AND uc.consent_version = ${version}
        GROUP BY u.pk, u.is_deleted
      ) t
    `);

    return result.rows[0];
  }
}
