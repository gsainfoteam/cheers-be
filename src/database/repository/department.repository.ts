import { Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { department } from "@drizzle/schema/department";
import { schoolEmailDomain } from "@drizzle/schema/school-email-domain";

export type DepartmentRow = typeof department.$inferSelect;

// 기준 데이터. 앱에서는 조회만 함 (수정은 어드민). 재학생의 학교는 인증한 이메일 도메인으로 정함
@Injectable()
export class DepartmentRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT d.* FROM department d JOIN school_email_domain sd ON sd.school_pk = d.school_pk
  WHERE sd.domain = ?1 AND d.is_active ORDER BY d.pk;
   */
  // 학과 목록: 비활성 학과는 숨김
  async findByEmailDomain(emailDomain: string): Promise<DepartmentRow[]> {
    const result = await this.dbService.db
      .select({ department })
      .from(department)
      .innerJoin(
        schoolEmailDomain,
        eq(schoolEmailDomain.schoolPk, department.schoolPk),
      )
      .where(
        and(
          eq(schoolEmailDomain.domain, emailDomain),
          eq(department.isActive, true),
        ),
      )
      .orderBy(asc(department.pk));

    return result.map((row) => row.department);
  }

  /*
  SELECT d.* FROM department d JOIN school_email_domain sd ON sd.school_pk = d.school_pk
  WHERE d.pk = ?1 AND sd.domain = ?2;
   */
  // 추가 정보 저장: 다른 학교의 학과를 고르지 못하게 함. 비활성 학과도 돌려줌 (판단은 서비스에서)
  async findByPkAndEmailDomain(
    departmentPk: number,
    emailDomain: string,
    tx?: TxType,
  ): Promise<DepartmentRow | null> {
    const result = await (tx ?? this.dbService.db)
      .select({ department })
      .from(department)
      .innerJoin(
        schoolEmailDomain,
        eq(schoolEmailDomain.schoolPk, department.schoolPk),
      )
      .where(
        and(
          eq(department.pk, departmentPk),
          eq(schoolEmailDomain.domain, emailDomain),
        ),
      );

    return result[0]?.department ?? null;
  }
}
