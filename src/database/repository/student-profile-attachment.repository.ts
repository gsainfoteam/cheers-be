import { Injectable } from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import { TxType } from "@src/global/types/tx.types";
import { studentProfileAttachment } from "../../../drizzle/schema/student-profile-attachment";
import { studentProfile } from "../../../drizzle/schema/student-profile";

export type StudentProfileAttachmentRow =
  typeof studentProfileAttachment.$inferSelect;

// 첨부 조회는 StudentRepository.findByUserPkWithLatestProfile (json_agg로 한 쿼리)
@Injectable()
export class StudentProfileAttachmentRepository {
  /*
  DELETE FROM student_profile_attachment
  WHERE profile_pk IN (SELECT pk FROM student_profile WHERE student_pk = ?1);
   */
  // 가입 중 유형 변경 때만 사용. 학생의 모든 프로필 버전에 속한 첨부를 지움
  async deleteByStudentPk(studentPk: string, tx: TxType): Promise<void> {
    await tx
      .delete(studentProfileAttachment)
      .where(
        inArray(
          studentProfileAttachment.profilePk,
          tx
            .select({ pk: studentProfile.pk })
            .from(studentProfile)
            .where(eq(studentProfile.studentPk, studentPk)),
        ),
      );
  }
}
