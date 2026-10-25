import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { TxType } from "@src/global/types/tx.types";
import { studentProfile } from "../../../drizzle/schema/student-profile";

export type StudentProfileRow = typeof studentProfile.$inferSelect;

// 최신 프로필 조회는 StudentRepository.findByUserPkWithLatestProfile (재학생 행과 한 쿼리)
@Injectable()
export class StudentProfileRepository {
  /*
  DELETE FROM student_profile WHERE student_pk = ?1;
   */
  // 가입 중 유형 변경 때만 사용 (버전은 원래 insert만 함). 첨부를 먼저 지운 뒤 호출
  async deleteByStudentPk(studentPk: string, tx: TxType): Promise<void> {
    await tx
      .delete(studentProfile)
      .where(eq(studentProfile.studentPk, studentPk));
  }
}
