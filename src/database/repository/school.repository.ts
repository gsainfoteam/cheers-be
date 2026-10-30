import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { school } from "@drizzle/schema/school";

export type SchoolRow = typeof school.$inferSelect;

// 기준 데이터 (seed). 조회만 함
@Injectable()
export class SchoolRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT * FROM school WHERE email_domain = ?1;
   */
  // 학교 이메일 인증 시 허용 도메인 검사
  async findByEmailDomain(emailDomain: string): Promise<SchoolRow | null> {
    const result = await this.dbService.db
      .select()
      .from(school)
      .where(eq(school.emailDomain, emailDomain));

    return result[0] ?? null;
  }
}
