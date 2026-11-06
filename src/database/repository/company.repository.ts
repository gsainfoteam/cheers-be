import { Injectable } from "@nestjs/common";
import { asc, eq, inArray, like, sql } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { escapeLike } from "@src/company/company.utils";
import { lockCompanyName } from "./company.sql";
import { companyAlias } from "@drizzle/schema/company-alias";
import { companyName } from "@drizzle/schema/company-name";

export type CompanyAliasRow = typeof companyAlias.$inferSelect;

export type CompanySearchRow = {
  pk: number;
  name: string;
  logoKey: string | null;
  // 검색어와 맞은 표기
  matchedName: string;
};

// 현업자 쪽 회사 검색 · 프로필 저장 때 회사 정하기. 어드민 관리는 AdminCompanyRepository
@Injectable()
export class CompanyRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT * FROM (
    SELECT DISTINCT ON (ca.pk) ca.pk, ca.name, ca.logo_key, cn.name AS matched_name,
      CASE WHEN cn.normalized_name = ?1 THEN 0 WHEN cn.normalized_name LIKE ?1 || '%' THEN 1 ELSE 2 END AS rank
    FROM company_name cn JOIN company_alias ca ON ca.pk = cn.alias_pk
    WHERE cn.normalized_name LIKE '%' || ?1 || '%'
    ORDER BY ca.pk, rank, length(cn.normalized_name)
  ) m ORDER BY rank, name LIMIT ?2;
   */
  // 표기(company_name)로 찾고 회사(alias) 하나당 가장 잘 맞는 표기 한 줄. 어드민 확인 전(needs_review) 회사도 포함
  async search(normalized: string, limit: number): Promise<CompanySearchRow[]> {
    const escaped = escapeLike(normalized);
    const rank = sql<number>`CASE
      WHEN ${companyName.normalizedName} = ${normalized} THEN 0
      WHEN ${companyName.normalizedName} LIKE ${`${escaped}%`} THEN 1
      ELSE 2 END`;
    const matches = this.dbService.db
      .selectDistinctOn([companyAlias.pk], {
        pk: companyAlias.pk,
        name: companyAlias.name,
        logoKey: companyAlias.logoKey,
        matchedName: sql<string>`${companyName.name}`.as("matched_name"),
        rank: rank.as("rank"),
      })
      .from(companyName)
      .innerJoin(companyAlias, eq(companyAlias.pk, companyName.aliasPk))
      .where(like(companyName.normalizedName, `%${escaped}%`))
      .orderBy(
        companyAlias.pk,
        rank,
        sql`length(${companyName.normalizedName})`,
      )
      .as("m");

    return this.dbService.db
      .select({
        pk: matches.pk,
        name: matches.name,
        logoKey: matches.logoKey,
        matchedName: matches.matchedName,
      })
      .from(matches)
      .orderBy(asc(matches.rank), asc(matches.name))
      .limit(limit);
  }

  /*
  SELECT * FROM company_alias WHERE pk = ?1 FOR KEY SHARE;
   */
  // 프로필이 가리키기 전에 잠가 어드민의 병합 · 삭제(FOR UPDATE)와 직렬화. 그사이 지워졌으면 null
  async findByPkForKeyShare(
    pk: number,
    tx: TxType,
  ): Promise<CompanyAliasRow | null> {
    const [row] = await tx
      .select()
      .from(companyAlias)
      .where(eq(companyAlias.pk, pk))
      .for("key share");
    return row ?? null;
  }

  /*
  SELECT pg_advisory_xact_lock(hashtext('company:' || ?1));
   */
  // 같은 표기를 동시에 등록할 때 회사가 하나만 생기도록 직렬화 (트랜잭션이 끝나면 풀림). 어드민 등록도 같은 잠금
  async lockName(normalized: string, tx: TxType): Promise<void> {
    await lockCompanyName(tx, normalized);
  }

  /*
  SELECT ca.* FROM company_name cn JOIN company_alias ca ON ca.pk = cn.alias_pk
  WHERE cn.normalized_name = ?1 FOR KEY SHARE OF ca;
   */
  async findByNormalizedNameForKeyShare(
    normalized: string,
    tx: TxType,
  ): Promise<CompanyAliasRow | null> {
    const [row] = await tx
      .select({ alias: companyAlias })
      .from(companyName)
      .innerJoin(companyAlias, eq(companyAlias.pk, companyName.aliasPk))
      .where(eq(companyName.normalizedName, normalized))
      .for("key share", { of: companyAlias });
    return row?.alias ?? null;
  }

  /*
  INSERT INTO company_alias (name, needs_review) VALUES (?1, true) RETURNING *;
  INSERT INTO company_name (alias_pk, name, normalized_name) VALUES (?, ?1, ?2);
   */
  // 등록되지 않은 이름 → 회사 + 표기를 만들고 어드민 검토 대기열에 넣음
  async createPending(
    name: string,
    normalized: string,
    tx: TxType,
  ): Promise<CompanyAliasRow> {
    const [alias] = await tx
      .insert(companyAlias)
      .values({ name, needsReview: true })
      .returning();
    await tx
      .insert(companyName)
      .values({ aliasPk: alias.pk, name, normalizedName: normalized });
    return alias;
  }

  /*
  SELECT logo_key FROM company_alias WHERE logo_key IN (?1, ...);
   */
  // 고아 파일 정리: 받은 key 중 DB가 참조하는 것만 돌려줌
  async findExistingLogoKeys(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];

    const rows = await this.dbService.db
      .select({ key: companyAlias.logoKey })
      .from(companyAlias)
      .where(inArray(companyAlias.logoKey, keys));

    return rows.flatMap((row) => (row.key ? [row.key] : []));
  }
}
