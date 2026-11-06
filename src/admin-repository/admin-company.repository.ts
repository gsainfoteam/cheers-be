import { Injectable } from "@nestjs/common";
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  sql,
  SQL,
} from "drizzle-orm";
import { escapeLike } from "@src/company/company.utils";
import { DatabaseService } from "@src/database/database.service";
import { lockCompanyName } from "@src/database/repository/company.sql";
import { TxType } from "@src/global/types/tx.types";
import { companyAlias } from "@drizzle/schema/company-alias";
import { companyName } from "@drizzle/schema/company-name";
import { graduatedProfile } from "@drizzle/schema/graduated-profile";

export type AdminCompanyAliasRow = typeof companyAlias.$inferSelect;
export type AdminCompanyNameRow = typeof companyName.$inferSelect;

export type AdminCompanyRow = AdminCompanyAliasRow & {
  names: { pk: number; name: string }[];
  // 이 회사를 가리키는 현업자 프로필 수 (탈퇴 · 유예기간 포함)
  graduatedCount: number;
};

export type AdminCompanyFilter = {
  // normalizeCompanyName 을 거친 검색어. 표기 중 하나라도 포함하면 걸림
  q?: string;
};

export type AdminCompanyPage = {
  rows: AdminCompanyRow[];
  total: number;
};

// 단일 테이블 select에서는 drizzle이 컬럼을 테이블 이름 없이("pk") 그려 서브쿼리 안의 같은 이름 컬럼으로 해석됨.
// 바깥 company_alias.pk를 가리키도록 테이블 이름을 직접 붙임
const outerAliasPk = sql`${companyAlias}.pk`;

const detailColumns = {
  ...getTableColumns(companyAlias),
  names: sql<{ pk: number; name: string }[]>`(
    SELECT COALESCE(json_agg(json_build_object('pk', cn.pk, 'name', cn.name) ORDER BY cn.pk), '[]'::json)
    FROM ${companyName} cn WHERE cn.alias_pk = ${outerAliasPk}
  )`,
  graduatedCount: sql<number>`(
    SELECT count(*)::int FROM ${graduatedProfile} gp WHERE gp.company_alias_pk = ${outerAliasPk}
  )`,
};

const toConditions = (filter: AdminCompanyFilter): SQL | undefined =>
  and(
    filter.q
      ? sql`EXISTS (
          SELECT 1 FROM ${companyName} cn
          WHERE cn.alias_pk = ${outerAliasPk}
            AND cn.normalized_name LIKE ${`%${escapeLike(filter.q)}%`}
        )`
      : undefined,
  );

// 회사(alias) · 표기(name) 관리. 현업자 쪽 검색 · 저장은 CompanyRepository
@Injectable()
export class AdminCompanyRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT ca.*, (표기 목록 json), (가리키는 프로필 수) FROM company_alias ca
  WHERE (q 가 있으면 EXISTS company_name LIKE '%q%')
  ORDER BY ca.needs_review DESC, ca.created_at DESC, ca.pk DESC LIMIT ?1 OFFSET ?2;
  SELECT count(*) FROM company_alias ca WHERE <같은 조건>;
   */
  // 검토가 필요한 회사(needs_review)를 맨 위에
  async findPage(
    filter: AdminCompanyFilter,
    offset: number,
    limit: number,
  ): Promise<AdminCompanyPage> {
    const db = this.dbService.db;
    const where = toConditions(filter);
    const [rows, [{ total }]] = await Promise.all([
      db
        .select(detailColumns)
        .from(companyAlias)
        .where(where)
        .orderBy(
          desc(companyAlias.needsReview),
          desc(companyAlias.createdAt),
          desc(companyAlias.pk),
        )
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(companyAlias).where(where),
    ]);

    return { rows, total };
  }

  /*
  findPage 와 같은 SELECT, WHERE ca.pk = ?1;
   */
  async findDetail(pk: number, tx?: TxType): Promise<AdminCompanyRow | null> {
    const [row] = await (tx ?? this.dbService.db)
      .select(detailColumns)
      .from(companyAlias)
      .where(eq(companyAlias.pk, pk));
    return row ?? null;
  }

  /*
  SELECT * FROM company_alias WHERE pk IN (?1, ...) ORDER BY pk FOR UPDATE;
   */
  // pk 순서로 잠가 교착을 막음. 현업자 프로필 저장의 FOR KEY SHARE 와 직렬화
  async findByPksForUpdate(
    pks: number[],
    tx: TxType,
  ): Promise<AdminCompanyAliasRow[]> {
    return tx
      .select()
      .from(companyAlias)
      .where(inArray(companyAlias.pk, pks))
      .orderBy(asc(companyAlias.pk))
      .for("update");
  }

  async findByPkForUpdate(
    pk: number,
    tx: TxType,
  ): Promise<AdminCompanyAliasRow | null> {
    const [row] = await this.findByPksForUpdate([pk], tx);
    return row ?? null;
  }

  /*
  SELECT pg_advisory_xact_lock(hashtext('company:' || ?1)); (정렬한 표기마다)
   */
  // 현업자의 직접 입력과 같은 잠금. 정렬 순서로 잡아 교착을 막음
  async lockNames(normalizedNames: string[], tx: TxType): Promise<void> {
    for (const normalized of [...normalizedNames].sort()) {
      await lockCompanyName(tx, normalized);
    }
  }

  /*
  SELECT cn.*, ca.name FROM company_name cn JOIN company_alias ca ON ca.pk = cn.alias_pk
  WHERE cn.normalized_name IN (?1, ...);
   */
  // 이미 등록된 표기 (어느 회사에 속하는지와 함께)
  async findNamesByNormalized(
    normalizedNames: string[],
    tx: TxType,
  ): Promise<(AdminCompanyNameRow & { aliasName: string })[]> {
    if (normalizedNames.length === 0) return [];
    const rows = await tx
      .select({ name: companyName, aliasName: companyAlias.name })
      .from(companyName)
      .innerJoin(companyAlias, eq(companyAlias.pk, companyName.aliasPk))
      .where(inArray(companyName.normalizedName, normalizedNames));
    return rows.map((row) => ({ ...row.name, aliasName: row.aliasName }));
  }

  /*
  SELECT * FROM company_alias WHERE name = ?1;
   */
  async findByName(
    name: string,
    tx: TxType,
  ): Promise<AdminCompanyAliasRow | null> {
    const [row] = await tx
      .select()
      .from(companyAlias)
      .where(eq(companyAlias.name, name));
    return row ?? null;
  }

  /*
  INSERT INTO company_alias (name) VALUES (?1) RETURNING *;
   */
  async insertAlias(name: string, tx: TxType): Promise<AdminCompanyAliasRow> {
    const [row] = await tx.insert(companyAlias).values({ name }).returning();
    return row;
  }

  /*
  INSERT INTO company_name (alias_pk, name, normalized_name) VALUES (?1, ?, ?), ...;
   */
  async insertNames(
    aliasPk: number,
    names: { name: string; normalizedName: string }[],
    tx: TxType,
  ): Promise<void> {
    if (names.length === 0) return;
    await tx
      .insert(companyName)
      .values(names.map((name) => ({ aliasPk, ...name })));
  }

  /*
  UPDATE company_alias SET <바꿀 값>, updated_at = now() WHERE pk = ?1;
   */
  async updateAlias(
    pk: number,
    set: Partial<
      Pick<AdminCompanyAliasRow, "name" | "needsReview" | "logoKey">
    >,
    tx: TxType,
  ): Promise<void> {
    await tx
      .update(companyAlias)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(companyAlias.pk, pk));
  }

  /*
  UPDATE company_name SET alias_pk = ?2 WHERE alias_pk = ?1;
   */
  async moveNames(
    sourcePk: number,
    targetPk: number,
    tx: TxType,
  ): Promise<void> {
    await tx
      .update(companyName)
      .set({ aliasPk: targetPk })
      .where(eq(companyName.aliasPk, sourcePk));
  }

  /*
  UPDATE graduated_profile SET company_alias_pk = ?2 WHERE company_alias_pk = ?1;
   */
  // 저장 당시 입력값 복사본(company)은 그대로 둠. 화면에는 company_alias.name 이 나감
  async moveProfiles(
    sourcePk: number,
    targetPk: number,
    tx: TxType,
  ): Promise<void> {
    await tx
      .update(graduatedProfile)
      .set({ companyAliasPk: targetPk })
      .where(eq(graduatedProfile.companyAliasPk, sourcePk));
  }

  /*
  SELECT count(*) FROM graduated_profile WHERE company_alias_pk = ?1;
   */
  async countProfiles(aliasPk: number, tx: TxType): Promise<number> {
    const [{ total }] = await tx
      .select({ total: count() })
      .from(graduatedProfile)
      .where(eq(graduatedProfile.companyAliasPk, aliasPk));
    return total;
  }

  /*
  SELECT * FROM company_name WHERE pk = ?1 AND alias_pk = ?2;
   */
  async findName(
    aliasPk: number,
    namePk: number,
    tx: TxType,
  ): Promise<AdminCompanyNameRow | null> {
    const [row] = await tx
      .select()
      .from(companyName)
      .where(and(eq(companyName.pk, namePk), eq(companyName.aliasPk, aliasPk)));
    return row ?? null;
  }

  /*
  DELETE FROM company_name WHERE pk = ?1;
   */
  async deleteName(namePk: number, tx: TxType): Promise<void> {
    await tx.delete(companyName).where(eq(companyName.pk, namePk));
  }

  /*
  DELETE FROM company_name WHERE alias_pk = ?1;
  DELETE FROM company_alias WHERE pk = ?1;
   */
  // FK는 NO ACTION이라 표기를 먼저 지움. 가리키는 프로필이 없을 때만 호출
  async deleteAlias(pk: number, tx: TxType): Promise<void> {
    await tx.delete(companyName).where(eq(companyName.aliasPk, pk));
    await tx.delete(companyAlias).where(eq(companyAlias.pk, pk));
  }
}
