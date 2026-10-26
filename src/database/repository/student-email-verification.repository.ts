import { Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { TxType } from "@src/global/types/tx.types";
import { CheersDBError } from "@src/global/exceptions/cheers-db.error";
import { studentEmailVerification } from "../../../drizzle/schema/student-email-verification";

export type StudentEmailVerificationRow =
  typeof studentEmailVerification.$inferSelect;

@Injectable()
export class StudentEmailVerificationRepository {
  /*
  SELECT * FROM student_email_verification WHERE student_pk = ?1;
   */
  // 학생 행을 FOR UPDATE로 잠근 뒤 호출 (행이 없을 수도 있어 이 행 대신 학생 행을 잠금)
  async findByStudentPk(
    studentPk: string,
    tx: TxType,
  ): Promise<StudentEmailVerificationRow | null> {
    const result = await tx
      .select()
      .from(studentEmailVerification)
      .where(eq(studentEmailVerification.studentPk, studentPk));

    return result[0] ?? null;
  }

  /*
  INSERT INTO student_email_verification (student_pk, email, code, attempt_count, expires_at, created_at)
  VALUES (?1, ?2, ?3, 0, ?4, ?5)
  ON CONFLICT (student_pk) DO UPDATE SET
    email = EXCLUDED.email, code = EXCLUDED.code, attempt_count = 0,
    expires_at = EXCLUDED.expires_at, created_at = EXCLUDED.created_at;
   */
  // 학생당 진행 중인 요청 1개. 재전송하면 덮어써서 이전 코드는 무효
  async upsert(
    row: Pick<
      StudentEmailVerificationRow,
      "studentPk" | "email" | "code" | "expiresAt" | "createdAt"
    >,
    tx: TxType,
  ): Promise<void> {
    await tx
      .insert(studentEmailVerification)
      .values({ ...row, attemptCount: 0 })
      .onConflictDoUpdate({
        target: studentEmailVerification.studentPk,
        set: {
          email: row.email,
          code: row.code,
          attemptCount: 0,
          expiresAt: row.expiresAt,
          createdAt: row.createdAt,
        },
      });
  }

  /*
  UPDATE student_email_verification SET attempt_count = attempt_count + 1
  WHERE student_pk = ?1 RETURNING attempt_count;
   */
  // 인증코드 틀림. 반환값: 증가한 시도 횟수
  async incrementAttemptCount(studentPk: string, tx: TxType): Promise<number> {
    const result = await tx
      .update(studentEmailVerification)
      .set({ attemptCount: sql`${studentEmailVerification.attemptCount} + 1` })
      .where(eq(studentEmailVerification.studentPk, studentPk))
      .returning({ attemptCount: studentEmailVerification.attemptCount });

    if (result.length === 0) {
      throw new CheersDBError("Failed to increment verification attempt");
    }

    return result[0].attemptCount;
  }

  /*
  DELETE FROM student_email_verification WHERE student_pk = ?1;
   */
  async deleteByStudentPk(studentPk: string, tx: TxType): Promise<void> {
    await tx
      .delete(studentEmailVerification)
      .where(eq(studentEmailVerification.studentPk, studentPk));
  }
}
