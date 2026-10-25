import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import {
  hasMissingRequiredConsent,
  hasValidAgreement,
  isLatestConsent,
} from "@src/database/repository/consent.sql";
import { userConsent } from "../../drizzle/schema/user-consent";

export type LatestConsent = {
  type: string;
  version: string;
  isRequired: boolean;
  url: string;
  // 이 버전에 유효한 동의(revoked_at IS NULL)가 있음
  agreed: boolean;
};

export type ConsentVersion = { type: string; version: string };

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

  async hasMissingRequiredConsent(
    userPk: string,
    tx?: TxType,
  ): Promise<boolean> {
    const result = await (tx ?? this.dbService.db).execute<{
      has_missing_required_consent: boolean;
    }>(
      sql`SELECT ${hasMissingRequiredConsent(userPk)} AS has_missing_required_consent`,
    );

    return result.rows[0].has_missing_required_consent;
  }

  /*
  INSERT INTO user_consent (pk, user_pk, consent_type, consent_version) VALUES ...
  ON CONFLICT DO NOTHING;
   */
  // 재동의는 새 행. 이미 유효한 동의가 있는 버전은 부분 unique index에 걸려 그대로 둠
  async insertAgreements(
    userPk: string,
    consents: ConsentVersion[],
    tx: TxType,
  ): Promise<void> {
    if (consents.length === 0) return;

    await tx
      .insert(userConsent)
      .values(
        consents.map(({ type, version }) => ({
          pk: randomUUID(),
          userPk,
          consentType: type,
          consentVersion: version,
        })),
      )
      .onConflictDoNothing();
  }

  /*
  UPDATE user_consent SET revoked_at = now()
  WHERE user_pk = ?1 AND consent_type IN (?2) AND revoked_at IS NULL;
   */
  // 이전 버전에 남은 유효한 동의까지 같이 철회
  async revokeByTypes(
    userPk: string,
    types: string[],
    tx: TxType,
  ): Promise<void> {
    if (types.length === 0) return;

    await tx
      .update(userConsent)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(userConsent.userPk, userPk),
          inArray(userConsent.consentType, types),
          isNull(userConsent.revokedAt),
        ),
      );
  }
}
