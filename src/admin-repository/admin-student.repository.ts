import { Injectable } from "@nestjs/common";
import { like } from "drizzle-orm";
import { TxType } from "@src/global/types/tx.types";
import { student } from "@drizzle/schema/student";

@Injectable()
export class AdminStudentRepository {
  /*
  SELECT pk FROM student WHERE email LIKE '%@' || ?1 LIMIT 1;
   */
  // student.email은 인증을 마친 이메일. 탈퇴 유예기간 중인 계정도 복구할 수 있어 포함.
  // 도메인은 DTO 형식 검사를 거쳐 와서 LIKE 특수문자(%, _)가 없음
  async existsByEmailDomain(domain: string, tx: TxType): Promise<boolean> {
    const result = await tx
      .select({ pk: student.pk })
      .from(student)
      .where(like(student.email, `%@${domain}`))
      .limit(1);

    return result.length > 0;
  }
}
