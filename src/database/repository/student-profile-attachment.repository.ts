import { Injectable } from "@nestjs/common";
import { asc, eq, inArray } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { studentProfileAttachment } from "../../../drizzle/schema/student-profile-attachment";
import { studentProfile } from "../../../drizzle/schema/student-profile";

export type StudentProfileAttachmentRow =
  typeof studentProfileAttachment.$inferSelect;

@Injectable()
export class StudentProfileAttachmentRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT * FROM student_profile_attachment WHERE profile_pk = ?1 ORDER BY sort_order;
   */
  async findByProfilePk(
    profilePk: string,
    tx?: TxType,
  ): Promise<StudentProfileAttachmentRow[]> {
    return (tx ?? this.dbService.db)
      .select()
      .from(studentProfileAttachment)
      .where(eq(studentProfileAttachment.profilePk, profilePk))
      .orderBy(asc(studentProfileAttachment.sortOrder));
  }

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
