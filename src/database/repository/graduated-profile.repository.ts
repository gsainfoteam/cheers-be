import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { TxType } from "@src/global/types/tx.types";
import { graduatedProfile } from "../../../drizzle/schema/graduated-profile";

export type GraduatedProfileRow = typeof graduatedProfile.$inferSelect;

// 프로필 조회는 GraduatedRepository.findByUserPkWithProfile (현업자 행과 한 쿼리)
@Injectable()
export class GraduatedProfileRepository {
  /*
  DELETE FROM graduated_profile WHERE graduated_pk = ?1;
   */
  async deleteByGraduatedPk(graduatedPk: string, tx: TxType): Promise<void> {
    await tx
      .delete(graduatedProfile)
      .where(eq(graduatedProfile.graduatedPk, graduatedPk));
  }
}
