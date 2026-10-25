import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { TxType } from "@src/global/types/tx.types";
import { userConsent } from "../../../drizzle/schema/user-consent";

export type ConsentVersion = { type: string; version: string };

// 동의 이력. 철회하면 revoked_at 기록, 재동의는 새 행
@Injectable()
export class UserConsentRepository {
  /*
  INSERT INTO user_consent (pk, user_pk, consent_type, consent_version) VALUES ...
  ON CONFLICT DO NOTHING;
   */
  // 이미 유효한 동의가 있는 버전은 부분 unique index에 걸려 그대로 둠
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
