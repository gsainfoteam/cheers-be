import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { TxType } from "@src/global/types/tx.types";
import { studentEmailVerification } from "../../../drizzle/schema/student-email-verification";

@Injectable()
export class StudentEmailVerificationRepository {
  /*
  DELETE FROM student_email_verification WHERE student_pk = ?1;
   */
  async deleteByStudentPk(studentPk: string, tx: TxType): Promise<void> {
    await tx
      .delete(studentEmailVerification)
      .where(eq(studentEmailVerification.studentPk, studentPk));
  }
}
