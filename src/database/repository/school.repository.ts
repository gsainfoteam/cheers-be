import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { school } from "@drizzle/schema/school";
import { schoolEmailDomain } from "@drizzle/schema/school-email-domain";

export type SchoolRow = typeof school.$inferSelect;

// 기준 데이터. 앱에서는 조회만 함 (수정은 어드민)
@Injectable()
export class SchoolRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT s.* FROM school s JOIN school_email_domain sd ON sd.school_pk = s.pk
  WHERE sd.domain = ?1;
   */
  // 학교 이메일 인증 시 허용 도메인 검사
  async findByEmailDomain(
    emailDomain: string,
    tx?: TxType,
  ): Promise<SchoolRow | null> {
    const result = await (tx ?? this.dbService.db)
      .select({ school })
      .from(school)
      .innerJoin(schoolEmailDomain, eq(schoolEmailDomain.schoolPk, school.pk))
      .where(eq(schoolEmailDomain.domain, emailDomain));

    return result[0]?.school ?? null;
  }
}
