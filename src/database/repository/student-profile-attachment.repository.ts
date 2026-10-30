import { Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { TxType } from "@src/global/types/tx.types";
import { studentProfileAttachment } from "../../../drizzle/schema/student-profile-attachment";
import { studentProfile } from "../../../drizzle/schema/student-profile";

export type StudentProfileAttachmentRow =
  typeof studentProfileAttachment.$inferSelect;

// 첨부 조회는 StudentRepository.findByUserPkWithLatestProfile (json_agg로 한 쿼리)
@Injectable()
export class StudentProfileAttachmentRepository {
  /*
  INSERT INTO student_profile_attachment (pk, profile_pk, kind, source, sort_order, url, file_name)
  VALUES ...;
   */
  // 새 프로필 버전의 첨부 전체. sort_order = 배열 순서
  async insertMany(
    profilePk: string,
    attachments: Pick<
      StudentProfileAttachmentRow,
      "kind" | "source" | "url" | "fileName"
    >[],
    tx: TxType,
  ): Promise<void> {
    if (attachments.length === 0) return;

    await tx.insert(studentProfileAttachment).values(
      attachments.map((attachment, index) => ({
        pk: randomUUID(),
        profilePk,
        sortOrder: index,
        ...attachment,
      })),
    );
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

  /*
  DELETE FROM student_profile_attachment
  WHERE source = 'file'
    AND profile_pk IN (SELECT pk FROM student_profile WHERE student_pk = ?1)
  RETURNING url;
   */
  // 탈퇴 처리 때 사용. 학생의 모든 버전의 파일 첨부를 지우고 S3 key를 돌려줌 (버전끼리 같은 파일을 참조하면 중복 제거)
  async deleteFilesByStudentPk(
    studentPk: string,
    tx: TxType,
  ): Promise<string[]> {
    const rows = await tx
      .delete(studentProfileAttachment)
      .where(
        and(
          eq(studentProfileAttachment.source, "file"),
          inArray(
            studentProfileAttachment.profilePk,
            tx
              .select({ pk: studentProfile.pk })
              .from(studentProfile)
              .where(eq(studentProfile.studentPk, studentPk)),
          ),
        ),
      )
      .returning({ url: studentProfileAttachment.url });

    return [...new Set(rows.map((row) => row.url))];
  }
}
