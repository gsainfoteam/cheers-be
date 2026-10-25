import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { consent } from "../../drizzle/schema/consent";
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

// 약관 최신 버전은 type별 (created_at, version)이 가장 큰 행 (UserRepository.findSignupProgress와 같은 규칙)
@Injectable()
export class ConsentRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT DISTINCT ON (c.type) c.type, c.version, c.is_required, c.url, uc.pk IS NOT NULL AS agreed
  FROM consent c
  LEFT JOIN user_consent uc
    ON uc.consent_type = c.type AND uc.consent_version = c.version
   AND uc.user_pk = ?1 AND uc.revoked_at IS NULL
  ORDER BY c.type, c.created_at DESC, c.version DESC;
   */
  // 유효한 동의는 약관 버전당 1개(부분 unique index)라 join으로 행이 늘지 않음
  async findLatestWithAgreement(
    userPk: string,
    tx?: TxType,
  ): Promise<LatestConsent[]> {
    return (tx ?? this.dbService.db)
      .selectDistinctOn([consent.type], {
        type: consent.type,
        version: consent.version,
        isRequired: consent.isRequired,
        url: consent.url,
        agreed: sql<boolean>`${userConsent.pk} IS NOT NULL`,
      })
      .from(consent)
      .leftJoin(
        userConsent,
        and(
          eq(userConsent.consentType, consent.type),
          eq(userConsent.consentVersion, consent.version),
          eq(userConsent.userPk, userPk),
          isNull(userConsent.revokedAt),
        ),
      )
      .orderBy(consent.type, desc(consent.createdAt), desc(consent.version));
  }

  // 필수 약관의 최신 버전 중 유효한 동의가 없는 것이 있음.
  // UserRepository.findSignupProgress의 has_missing_required_consent와 같은 조건 — 바꿀 때는 두 곳 같이
  async hasMissingRequiredConsent(
    userPk: string,
    tx?: TxType,
  ): Promise<boolean> {
    const result = await (tx ?? this.dbService.db).execute<{
      has_missing_required_consent: boolean;
    }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM consent c
        WHERE c.is_required
          AND NOT EXISTS (
            SELECT 1 FROM consent newer
            WHERE newer.type = c.type
              AND (newer.created_at, newer.version) > (c.created_at, c.version)
          )
          AND NOT EXISTS (
            SELECT 1 FROM user_consent uc
            WHERE uc.user_pk = ${userPk}
              AND uc.consent_type = c.type
              AND uc.consent_version = c.version
              AND uc.revoked_at IS NULL
          )
      ) AS has_missing_required_consent
    `);

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
