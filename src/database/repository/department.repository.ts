import { Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { department } from "../../../drizzle/schema/department";
import { school } from "../../../drizzle/schema/school";

export type DepartmentRow = typeof department.$inferSelect;

// 기준 데이터 (seed). 조회만 함. 재학생의 학교는 인증한 이메일 도메인으로 정함
@Injectable()
export class DepartmentRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT d.* FROM department d JOIN school s ON s.pk = d.school_pk
  WHERE s.email_domain = ?1 ORDER BY d.pk;
   */
  async findByEmailDomain(emailDomain: string): Promise<DepartmentRow[]> {
    const result = await this.dbService.db
      .select({ department })
      .from(department)
      .innerJoin(school, eq(school.pk, department.schoolPk))
      .where(eq(school.emailDomain, emailDomain))
      .orderBy(asc(department.pk));

    return result.map((row) => row.department);
  }

  /*
  SELECT d.* FROM department d JOIN school s ON s.pk = d.school_pk
  WHERE d.pk = ?1 AND s.email_domain = ?2;
   */
  // 추가 정보 저장: 다른 학교의 학과를 고르지 못하게 함
  async findByPkAndEmailDomain(
    departmentPk: number,
    emailDomain: string,
    tx?: TxType,
  ): Promise<DepartmentRow | null> {
    const result = await (tx ?? this.dbService.db)
      .select({ department })
      .from(department)
      .innerJoin(school, eq(school.pk, department.schoolPk))
      .where(
        and(
          eq(department.pk, departmentPk),
          eq(school.emailDomain, emailDomain),
        ),
      );

    return result[0]?.department ?? null;
  }
}
