import { Injectable } from "@nestjs/common";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { CheersDBError } from "@src/global/exceptions/cheers-db.error";
import { student } from "../../../drizzle/schema/student";
import { studentEmailVerification } from "../../../drizzle/schema/student-email-verification";
import { studentProfile } from "../../../drizzle/schema/student-profile";
import { studentProfileAttachment } from "../../../drizzle/schema/student-profile-attachment";
import { department } from "../../../drizzle/schema/department";

export type StudentRow = typeof student.$inferSelect;
export type StudentProfileRow = typeof studentProfile.$inferSelect;
export type StudentProfileAttachmentRow =
  typeof studentProfileAttachment.$inferSelect;

export type StudentInfo = {
  student: StudentRow;
  // 가장 큰 version. 추가 정보 입력 전이면 null
  profile: {
    profile: StudentProfileRow;
    department: { pk: number; name: string };
    attachments: StudentProfileAttachmentRow[];
  } | null;
};

@Injectable()
export class StudentRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  INSERT INTO student (pk, user_pk) VALUES (?1, ?2) RETURNING *;
   */
  async insert(userPk: string, tx: TxType): Promise<StudentRow> {
    const result = await tx
      .insert(student)
      .values({ pk: randomUUID(), userPk })
      .returning();

    if (result.length === 0) {
      throw new CheersDBError("Failed to insert student");
    }

    return result[0];
  }

  /*
  DELETE FROM student_email_verification WHERE student_pk = ?;
  DELETE FROM student_profile_attachment WHERE profile_pk IN (SELECT pk FROM student_profile WHERE student_pk = ?);
  DELETE FROM student_profile WHERE student_pk = ?;
  DELETE FROM student WHERE pk = ?;
   */
  // 가입 중 유형 변경. FK cascade가 없으므로 자식부터 삭제.
  // 커피챗 요청은 가입을 마친(active) 재학생만 만들 수 있어 여기서는 없음
  async deleteByUserPk(userPk: string, tx: TxType): Promise<void> {
    const [row] = await tx
      .select({ pk: student.pk })
      .from(student)
      .where(eq(student.userPk, userPk));
    if (!row) return;

    await tx
      .delete(studentEmailVerification)
      .where(eq(studentEmailVerification.studentPk, row.pk));
    await tx
      .delete(studentProfileAttachment)
      .where(
        inArray(
          studentProfileAttachment.profilePk,
          tx
            .select({ pk: studentProfile.pk })
            .from(studentProfile)
            .where(eq(studentProfile.studentPk, row.pk)),
        ),
      );
    await tx.delete(studentProfile).where(eq(studentProfile.studentPk, row.pk));
    await tx.delete(student).where(eq(student.pk, row.pk));
  }

  /*
  UPDATE student SET email = NULL, updated_at = now() WHERE user_pk = ?1;
   */
  // 회원 탈퇴: 학교 이메일 UQ를 풀어서 같은 이메일로 다시 가입할 수 있게 함
  async clearEmail(userPk: string, tx: TxType): Promise<void> {
    await tx
      .update(student)
      .set({ email: null, updatedAt: new Date() })
      .where(eq(student.userPk, userPk));
  }

  /*
  SELECT * FROM student WHERE user_pk = ?1;
  SELECT sp.*, d.pk, d.name FROM student_profile sp JOIN department d ON d.pk = sp.department_pk
  WHERE sp.student_pk = ?2 ORDER BY sp.version DESC LIMIT 1;
  SELECT * FROM student_profile_attachment WHERE profile_pk = ?3 ORDER BY sort_order;
   */
  async findInfoByUserPk(
    userPk: string,
    tx?: TxType,
  ): Promise<StudentInfo | null> {
    const db = tx ?? this.dbService.db;
    const [studentRow] = await db
      .select()
      .from(student)
      .where(eq(student.userPk, userPk));
    if (!studentRow) return null;

    const [latest] = await db
      .select({
        profile: studentProfile,
        department: { pk: department.pk, name: department.name },
      })
      .from(studentProfile)
      .innerJoin(department, eq(department.pk, studentProfile.departmentPk))
      .where(eq(studentProfile.studentPk, studentRow.pk))
      .orderBy(desc(studentProfile.version))
      .limit(1);
    if (!latest) return { student: studentRow, profile: null };

    const attachments = await db
      .select()
      .from(studentProfileAttachment)
      .where(eq(studentProfileAttachment.profilePk, latest.profile.pk))
      .orderBy(asc(studentProfileAttachment.sortOrder));

    return { student: studentRow, profile: { ...latest, attachments } };
  }
}
