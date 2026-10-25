import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { CheersDBError } from "@src/global/exceptions/cheers-db.error";
import { graduated } from "../../../drizzle/schema/graduated";
import { graduatedProfile } from "../../../drizzle/schema/graduated-profile";

export type GraduatedRow = typeof graduated.$inferSelect;
export type GraduatedProfileRow = typeof graduatedProfile.$inferSelect;

export type GraduatedInfo = {
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
  DELETE FROM graduated_profile WHERE graduated_pk = ?;
  DELETE FROM graduated WHERE pk = ? RETURNING business_card_key;
   */
  // 가입 중 유형 변경. 지운 명함의 S3 key를 반환해서 커밋 후 파일도 지우게 함.
  // 커피챗 요청은 가입을 마친(active) 현업자만 받을 수 있어 여기서는 없음
  async deleteByUserPk(userPk: string, tx: TxType): Promise<string | null> {
    const [row] = await tx
      .select({ pk: graduated.pk })
      .from(graduated)
      .where(eq(graduated.userPk, userPk));
    if (!row) return null;

    await tx
      .delete(graduatedProfile)
      .where(eq(graduatedProfile.graduatedPk, row.pk));
    const [deleted] = await tx
      .delete(graduated)
      .where(eq(graduated.pk, row.pk))
      .returning({ businessCardKey: graduated.businessCardKey });

    return deleted?.businessCardKey ?? null;
  }

  /*
  SELECT business_card_key FROM graduated WHERE user_pk = ?1;
  UPDATE graduated SET business_card_key = NULL, updated_at = now() WHERE user_pk = ?1;
   */
  // 회원 탈퇴: 명함 key를 지우고 기존 key를 반환 (커밋 후 S3 파일 삭제용)
  async clearBusinessCard(userPk: string, tx: TxType): Promise<string | null> {
    const [row] = await tx
      .select({ businessCardKey: graduated.businessCardKey })
      .from(graduated)
      .where(eq(graduated.userPk, userPk));
    if (!row?.businessCardKey) return null;

    await tx
      .update(graduated)
      .set({ businessCardKey: null, updatedAt: new Date() })
      .where(eq(graduated.userPk, userPk));

    return row.businessCardKey;
  }

  /*
  SELECT g.*, gp.* FROM graduated g LEFT JOIN graduated_profile gp ON gp.graduated_pk = g.pk
  WHERE g.user_pk = ?1;
   */
  async findInfoByUserPk(
    userPk: string,
    tx?: TxType,
  ): Promise<GraduatedInfo | null> {
    const [row] = await (tx ?? this.dbService.db)
      .select({ graduated, profile: graduatedProfile })
      .from(graduated)
      .leftJoin(
        graduatedProfile,
        eq(graduatedProfile.graduatedPk, graduated.pk),
      )
      .where(eq(graduated.userPk, userPk));

    return row ?? null;
  }
}
