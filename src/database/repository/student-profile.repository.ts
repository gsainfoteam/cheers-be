import { Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { studentProfile } from "../../../drizzle/schema/student-profile";
import { department } from "../../../drizzle/schema/department";

export type StudentProfileRow = typeof studentProfile.$inferSelect;

export type StudentProfileWithDepartment = {
  profile: StudentProfileRow;
  department: { pk: number; name: string };
};

@Injectable()
export class StudentProfileRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT sp.*, d.pk, d.name FROM student_profile sp JOIN department d ON d.pk = sp.department_pk
  WHERE sp.student_pk = ?1 ORDER BY sp.version DESC LIMIT 1;
   */
  // 현재 정보 = 가장 큰 version. 추가 정보 입력 전이면 null
  async findLatestByStudentPk(
    studentPk: string,
    tx?: TxType,
  ): Promise<StudentProfileWithDepartment | null> {
    const result = await (tx ?? this.dbService.db)
      .select({
        profile: studentProfile,
        department: { pk: department.pk, name: department.name },
      })
      .from(studentProfile)
      .innerJoin(department, eq(department.pk, studentProfile.departmentPk))
      .where(eq(studentProfile.studentPk, studentPk))
      .orderBy(desc(studentProfile.version))
      .limit(1);

    return result[0] ?? null;
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
