import { Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { graduatedProfile } from "@drizzle/schema/graduated-profile";

export type GraduatedProfileRow = typeof graduatedProfile.$inferSelect;

export type GraduatedProfileInput = Pick<
  GraduatedProfileRow,
  | "graduatedPk"
  | "nickname"
  | "companyAliasPk"
  | "department"
  | "job"
  | "hashtags"
  | "links"
>;

// 프로필 조회는 GraduatedRepository.findByUserPkWithProfile (현업자 행과 한 쿼리)
@Injectable()
export class GraduatedProfileRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT 1 FROM graduated_profile WHERE lower(nickname) = lower(?1) LIMIT 1;
   */
  // 닉네임 사용 여부 (대소문자 무시). 탈퇴 유예 중인 유저의 프로필도 purge 전까지 포함
  async existsByNickname(nickname: string): Promise<boolean> {
    const rows = await this.dbService.db
      .select({ one: sql<number>`1` })
      .from(graduatedProfile)
      .where(sql`lower(${graduatedProfile.nickname}) = lower(${nickname})`)
      .limit(1);
    return rows.length > 0;
  }

  /*
  INSERT INTO graduated_profile (graduated_pk, nickname, company_alias_pk, department, job, hashtags, links)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
  ON CONFLICT (graduated_pk) DO UPDATE SET
    company_alias_pk = EXCLUDED.company_alias_pk, department = EXCLUDED.department, job = EXCLUDED.job,
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
          companyAliasPk: profile.companyAliasPk,
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
