import { Injectable } from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { CheersDBError } from "@src/global/exceptions/cheers-db.error";
import { GraduatedProfileRow } from "@src/database/repository/graduated-profile.repository";
import { graduated } from "../../../drizzle/schema/graduated";
import { graduatedProfile } from "../../../drizzle/schema/graduated-profile";

export type GraduatedRow = typeof graduated.$inferSelect;

export type GraduatedWithProfile = {
  graduated: GraduatedRow;
  // 추가 정보 입력 전이면 null
  profile: GraduatedProfileRow | null;
};

@Injectable()
export class GraduatedRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  INSERT INTO graduated (pk, user_pk) VALUES (?1, ?2) RETURNING *;
   */
  async insert(userPk: string, tx: TxType): Promise<GraduatedRow> {
    const result = await tx
      .insert(graduated)
      .values({ pk: randomUUID(), userPk })
      .returning();

    if (result.length === 0) {
      throw new CheersDBError("Failed to insert graduated");
    }

    return result[0];
  }

  /*
  SELECT * FROM graduated WHERE user_pk = ?1;
   */
  async findByUserPk(
    userPk: string,
    tx?: TxType,
  ): Promise<GraduatedRow | null> {
    const result = await (tx ?? this.dbService.db)
      .select()
      .from(graduated)
      .where(eq(graduated.userPk, userPk));

    return result[0] ?? null;
  }

  /*
  SELECT g.*, gp.* FROM graduated g
  LEFT JOIN graduated_profile gp ON gp.graduated_pk = g.pk
  WHERE g.user_pk = ?1;
   */
  // 내 정보 조회: 현업자 행과 추가 정보를 한 쿼리로
  async findByUserPkWithProfile(
    userPk: string,
    tx?: TxType,
  ): Promise<GraduatedWithProfile | null> {
    const result = await (tx ?? this.dbService.db)
      .select({ graduated, profile: graduatedProfile })
      .from(graduated)
      .leftJoin(
        graduatedProfile,
        eq(graduatedProfile.graduatedPk, graduated.pk),
      )
      .where(eq(graduated.userPk, userPk));

    return result[0] ?? null;
  }

  /*
  UPDATE graduated SET business_card_key = ?2, verified_at = now(), updated_at = now() WHERE pk = ?1;
   */
  // 명함 인증: 별도 검수 없이 즉시 인증. 다시 등록하면 verified_at도 새 시각으로
  async updateBusinessCard(
    graduatedPk: string,
    businessCardKey: string,
    tx: TxType,
  ): Promise<void> {
    const now = new Date();
    await tx
      .update(graduated)
      .set({ businessCardKey, verifiedAt: now, updatedAt: now })
      .where(eq(graduated.pk, graduatedPk));
  }

  /*
  SELECT business_card_key FROM graduated WHERE business_card_key IN (?1, ...);
   */
  // 고아 파일 정리: 받은 key 중 DB가 참조하는 것만 돌려줌
  async findExistingBusinessCardKeys(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];

    const rows = await this.dbService.db
      .select({ key: graduated.businessCardKey })
      .from(graduated)
      .where(inArray(graduated.businessCardKey, keys));

    return rows.flatMap((row) => (row.key ? [row.key] : []));
  }

  /*
  UPDATE graduated SET business_card_key = NULL, updated_at = now() WHERE pk = ?1;
   */
  // 회원 탈퇴: 명함 key 제거 (S3 파일은 커밋 후 서비스에서 삭제)
  async clearBusinessCardKey(graduatedPk: string, tx: TxType): Promise<void> {
    await tx
      .update(graduated)
      .set({ businessCardKey: null, updatedAt: new Date() })
      .where(eq(graduated.pk, graduatedPk));
  }

  /*
  DELETE FROM graduated WHERE pk = ?1;
   */
  // FK cascade가 없으므로 graduated_profile을 먼저 지운 뒤 호출
  async deleteByPk(graduatedPk: string, tx: TxType): Promise<void> {
    await tx.delete(graduated).where(eq(graduated.pk, graduatedPk));
  }
}
