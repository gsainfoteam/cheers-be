import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { graduatedProfile } from "../../../drizzle/schema/graduated-profile";

export type GraduatedProfileRow = typeof graduatedProfile.$inferSelect;

@Injectable()
export class GraduatedProfileRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT * FROM graduated_profile WHERE graduated_pk = ?1;
   */
  // 추가 정보 입력 전이면 null
  async findByGraduatedPk(
    graduatedPk: string,
    tx?: TxType,
  ): Promise<GraduatedProfileRow | null> {
    const result = await (tx ?? this.dbService.db)
      .select()
      .from(graduatedProfile)
      .where(eq(graduatedProfile.graduatedPk, graduatedPk));

    return result[0] ?? null;
  }

  /*
  DELETE FROM graduated_profile WHERE graduated_pk = ?1;
   */
  async deleteByGraduatedPk(graduatedPk: string, tx: TxType): Promise<void> {
    await tx
      .delete(graduatedProfile)
      .where(eq(graduatedProfile.graduatedPk, graduatedPk));
  }
}
