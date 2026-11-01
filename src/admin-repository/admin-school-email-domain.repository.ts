import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { schoolEmailDomain } from "@drizzle/schema/school-email-domain";

export type AdminSchoolEmailDomainRow = typeof schoolEmailDomain.$inferSelect;

@Injectable()
export class AdminSchoolEmailDomainRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT * FROM school_email_domain ORDER BY pk;
   */
  async findAll(): Promise<AdminSchoolEmailDomainRow[]> {
    return this.dbService.db
      .select()
      .from(schoolEmailDomain)
      .orderBy(asc(schoolEmailDomain.pk));
  }

  /*
  SELECT * FROM school_email_domain WHERE school_pk = ?1 ORDER BY pk;
   */
  async findBySchoolPk(
    schoolPk: number,
    tx: TxType,
  ): Promise<AdminSchoolEmailDomainRow[]> {
    return tx
      .select()
      .from(schoolEmailDomain)
      .where(eq(schoolEmailDomain.schoolPk, schoolPk))
      .orderBy(asc(schoolEmailDomain.pk));
  }

  /*
  DELETE FROM school_email_domain WHERE school_pk = ?1 AND domain IN (?2);
   */
  async deleteBySchoolPkAndDomains(
    schoolPk: number,
    domains: string[],
    tx: TxType,
  ): Promise<void> {
    await tx
      .delete(schoolEmailDomain)
      .where(
        and(
          eq(schoolEmailDomain.schoolPk, schoolPk),
          inArray(schoolEmailDomain.domain, domains),
        ),
      );
  }

  /*
  INSERT INTO school_email_domain (school_pk, domain) VALUES (?1, ?2), ...;
   */
  // 다른 학교의 도메인이면 domain UNIQUE 위반
  async insertMany(
    schoolPk: number,
    domains: string[],
    tx: TxType,
  ): Promise<void> {
    await tx
      .insert(schoolEmailDomain)
      .values(domains.map((domain) => ({ schoolPk, domain })));
  }
}
