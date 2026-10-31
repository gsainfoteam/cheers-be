import { Injectable } from "@nestjs/common";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { graduated } from "@drizzle/schema/graduated";
import { graduatedProfile } from "@drizzle/schema/graduated-profile";
import { users } from "@drizzle/schema/users";

export type AdminGraduatedRow = {
  graduatedPk: string;
  name: string | null;
  // 추가 정보 입력 전이면 null
  nickname: string | null;
  company: string | null;
  job: string | null;
  hasBusinessCard: boolean;
  verifiedAt: Date | null;
  status: "pending" | "active";
  withdrawRequestedAt: Date | null;
};

export type AdminGraduatedPage = {
  rows: AdminGraduatedRow[];
  total: number;
};

// 탈퇴 처리가 끝난 현업자는 명함과 이름이 지워져 관리할 것이 없음
const isManageable = eq(users.isDeleted, false);

@Injectable()
export class AdminGraduatedRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT g.pk, u.name, gp.nickname, gp.company, gp.job, g.business_card_key IS NOT NULL,
    g.verified_at, u.status, u.withdraw_requested_at
  FROM graduated g
  JOIN users u ON u.pk = g.user_pk
  LEFT JOIN graduated_profile gp ON gp.graduated_pk = g.pk
  WHERE u.is_deleted = false
  ORDER BY g.verified_at DESC NULLS LAST, g.pk LIMIT ?1 OFFSET ?2;
  SELECT count(*) FROM graduated g JOIN users u ON u.pk = g.user_pk WHERE u.is_deleted = false;
   */
  async findPage(offset: number, limit: number): Promise<AdminGraduatedPage> {
    const db = this.dbService.db;
    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          graduatedPk: graduated.pk,
          name: users.name,
          nickname: graduatedProfile.nickname,
          company: graduatedProfile.company,
          job: graduatedProfile.job,
          hasBusinessCard: sql<boolean>`${graduated.businessCardKey} IS NOT NULL`,
          verifiedAt: graduated.verifiedAt,
          status: users.status,
          withdrawRequestedAt: users.withdrawRequestedAt,
        })
        .from(graduated)
        .innerJoin(users, eq(users.pk, graduated.userPk))
        .leftJoin(
          graduatedProfile,
          eq(graduatedProfile.graduatedPk, graduated.pk),
        )
        .where(isManageable)
        // 같은 값이 있어도 페이지 사이 순서가 흔들리지 않게 pk를 마지막 기준으로
        .orderBy(sql`${desc(graduated.verifiedAt)} NULLS LAST`, graduated.pk)
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(graduated)
        .innerJoin(users, eq(users.pk, graduated.userPk))
        .where(isManageable),
    ]);

    return { rows, total };
  }

  /*
  SELECT g.business_card_key FROM graduated g JOIN users u ON u.pk = g.user_pk
  WHERE g.pk = ?1 AND u.is_deleted = false;
   */
  // 현업자가 없으면 null, 명함이 없으면 { businessCardKey: null }
  async findCardByPk(
    graduatedPk: string,
  ): Promise<{ businessCardKey: string | null } | null> {
    const result = await this.dbService.db
      .select({ businessCardKey: graduated.businessCardKey })
      .from(graduated)
      .innerJoin(users, eq(users.pk, graduated.userPk))
      .where(and(eq(graduated.pk, graduatedPk), isManageable));

    return result[0] ?? null;
  }

  /*
  SELECT g.verified_at FROM graduated g JOIN users u ON u.pk = g.user_pk
  WHERE g.pk = ?1 AND u.is_deleted = false
  FOR UPDATE OF u;
   */
  // 명함 등록 · 로그인(유형 변경) · 탈퇴 처리와 같은 유저 행 잠금으로 직렬화 (잠금 순서도 users → graduated로 같음)
  async findForUpdate(
    graduatedPk: string,
    tx: TxType,
  ): Promise<{ verifiedAt: Date | null } | null> {
    const result = await tx
      .select({ verifiedAt: graduated.verifiedAt })
      .from(graduated)
      .innerJoin(users, eq(users.pk, graduated.userPk))
      .where(and(eq(graduated.pk, graduatedPk), isManageable))
      .for("update", { of: users });

    return result[0] ?? null;
  }

  /*
  UPDATE graduated SET verified_at = NULL, business_card_key = NULL, updated_at = now() WHERE pk = ?1;
   */
  // 명함 인증 취소. S3 파일은 지우지 않고 참조만 없앰 (OrphanFileService가 정리)
  async clearVerification(graduatedPk: string, tx: TxType): Promise<void> {
    await tx
      .update(graduated)
      .set({ verifiedAt: null, businessCardKey: null, updatedAt: new Date() })
      .where(eq(graduated.pk, graduatedPk));
  }
}
