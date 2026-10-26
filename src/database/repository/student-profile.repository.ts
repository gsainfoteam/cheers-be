import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { TxType } from "@src/global/types/tx.types";
import { CheersDBError } from "@src/global/exceptions/cheers-db.error";
import { studentProfile } from "../../../drizzle/schema/student-profile";

export type StudentProfileRow = typeof studentProfile.$inferSelect;

// 최신 프로필 조회는 StudentRepository.findByUserPkWithLatestProfile (재학생 행과 한 쿼리)
@Injectable()
export class StudentProfileRepository {
  /*
  INSERT INTO student_profile (pk, student_pk, version, department_pk, interests, activities)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING *;
   */
  // 추가 정보가 바뀌었을 때 새 버전. 학생 행을 잠근 뒤 호출하므로 (student_pk, version) 충돌 없음
  async insert(
    row: Pick<
      StudentProfileRow,
      "studentPk" | "version" | "departmentPk" | "interests" | "activities"
    >,
    tx: TxType,
  ): Promise<StudentProfileRow> {
    const result = await tx
      .insert(studentProfile)
      .values({ pk: randomUUID(), ...row })
      .returning();

    if (result.length === 0) {
      throw new CheersDBError("Failed to insert student profile");
    }

    return result[0];
  }

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
