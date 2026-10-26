import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { TxType } from "@src/global/types/tx.types";
import { graduatedProfile } from "../../../drizzle/schema/graduated-profile";

export type GraduatedProfileRow = typeof graduatedProfile.$inferSelect;

export type GraduatedProfileInput = Pick<
  GraduatedProfileRow,
  | "graduatedPk"
  | "nickname"
  | "company"
  | "department"
  | "job"
  | "hashtags"
  | "links"
>;

// 프로필 조회는 GraduatedRepository.findByUserPkWithProfile (현업자 행과 한 쿼리)
@Injectable()
export class GraduatedProfileRepository {
  /*
  INSERT INTO graduated_profile (graduated_pk, nickname, company, department, job, hashtags, links)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
  ON CONFLICT (graduated_pk) DO UPDATE SET
    company = EXCLUDED.company, department = EXCLUDED.department, job = EXCLUDED.job,
    hashtags = EXCLUDED.hashtags, links = EXCLUDED.links, updated_at = now();
   */
  // 추가 정보 저장 · 수정 (전체 교체). nickname은 가입 후 변경 불가라 첫 INSERT에만 들어감
  async upsert(profile: GraduatedProfileInput, tx: TxType): Promise<void> {
    await tx
      .insert(graduatedProfile)
      .values(profile)
      .onConflictDoUpdate({
        target: graduatedProfile.graduatedPk,
        set: {
          company: profile.company,
          department: profile.department,
          job: profile.job,
          hashtags: profile.hashtags,
          links: profile.links,
          updatedAt: new Date(),
        },
      });
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
