import { Injectable } from "@nestjs/common";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { CheersDBError } from "@src/global/exceptions/cheers-db.error";
import { StudentProfileRow } from "@src/database/repository/student-profile.repository";
import { StudentProfileAttachmentRow } from "@src/database/repository/student-profile-attachment.repository";
import { student } from "@drizzle/schema/student";
import { studentProfile } from "@drizzle/schema/student-profile";
import { studentProfileAttachment } from "@drizzle/schema/student-profile-attachment";
import { department } from "@drizzle/schema/department";

export type StudentRow = typeof student.$inferSelect;

export type StudentAttachment = Pick<
  StudentProfileAttachmentRow,
  "kind" | "source" | "url" | "fileName"
>;

export type StudentWithLatestProfile = {
  student: StudentRow;
  // 가장 큰 version과 그 학과 · 첨부(sort_order 순). 추가 정보 입력 전이면 null
  latest: {
    profile: StudentProfileRow;
    department: { pk: number; name: string };
    attachments: StudentAttachment[];
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
  SELECT * FROM student WHERE user_pk = ?1;
   */
  async findByUserPk(userPk: string, tx?: TxType): Promise<StudentRow | null> {
    const result = await (tx ?? this.dbService.db)
      .select()
      .from(student)
      .where(eq(student.userPk, userPk));

    return result[0] ?? null;
  }

  /*
  SELECT * FROM student WHERE user_pk = ?1 FOR UPDATE;
   */
  // 인증코드 전송 · 확인, 추가 정보 저장: 같은 학생의 동시 요청을 직렬화
  async findByUserPkForUpdate(
    userPk: string,
    tx: TxType,
  ): Promise<StudentRow | null> {
    const result = await tx
      .select()
      .from(student)
      .where(eq(student.userPk, userPk))
      .for("update");

    return result[0] ?? null;
  }

  /*
  SELECT 1 FROM student WHERE email = ?1 AND pk <> ?2 LIMIT 1;
   */
  // 다른 계정이 이미 인증한 학교 이메일인지. 탈퇴 유예기간 중인 계정도 이메일을 갖고 있으므로 포함
  async existsByEmailExcept(
    email: string,
    studentPk: string,
    tx: TxType,
  ): Promise<boolean> {
    const result = await tx
      .select({ pk: student.pk })
      .from(student)
      .where(and(eq(student.email, email), ne(student.pk, studentPk)))
      .limit(1);

    return result.length > 0;
  }

  /*
  UPDATE student SET email = ?2, verified_at = now(), updated_at = now() WHERE pk = ?1;
   */
  // 학교 이메일 인증 완료. 같은 이메일을 동시에 인증하면 email UNIQUE 위반
  async markVerified(
    studentPk: string,
    email: string,
    tx: TxType,
  ): Promise<void> {
    const now = new Date();
    await tx
      .update(student)
      .set({ email, verifiedAt: now, updatedAt: now })
      .where(eq(student.pk, studentPk));
  }

  /*
  SELECT s.*, latest.* FROM student s
  LEFT JOIN LATERAL (
    SELECT sp.*, d.name AS department_name,
      (SELECT COALESCE(json_agg(json_build_object('kind', a.kind, 'source', a.source,
                'url', a.url, 'fileName', a.file_name) ORDER BY a.sort_order), '[]')
       FROM student_profile_attachment a WHERE a.profile_pk = sp.pk) AS attachments
    FROM student_profile sp
    JOIN department d ON d.pk = sp.department_pk
    WHERE sp.student_pk = s.pk ORDER BY sp.version DESC LIMIT 1
  ) latest ON true
  WHERE s.user_pk = ?1;
   */
  // 내 정보 조회: 재학생 행과 현재 정보(가장 큰 version) · 학과 · 첨부를 한 쿼리로
  async findByUserPkWithLatestProfile(
    userPk: string,
    tx?: TxType,
  ): Promise<StudentWithLatestProfile | null> {
    const db = tx ?? this.dbService.db;
    const latest = db
      .select({
        pk: studentProfile.pk,
        studentPk: studentProfile.studentPk,
        version: studentProfile.version,
        departmentPk: studentProfile.departmentPk,
        interests: studentProfile.interests,
        activities: studentProfile.activities,
        createdAt: studentProfile.createdAt,
        departmentName: sql<string>`${department.name}`.as("department_name"),
        // 버전 하나에 첨부가 여러 개라 json 배열로 묶음 (pg 드라이버가 파싱)
        attachments: sql<StudentAttachment[]>`(
          SELECT COALESCE(
            json_agg(
              json_build_object(
                'kind', ${studentProfileAttachment.kind},
                'source', ${studentProfileAttachment.source},
                'url', ${studentProfileAttachment.url},
                'fileName', ${studentProfileAttachment.fileName}
              )
              ORDER BY ${studentProfileAttachment.sortOrder}
            ),
            '[]'
          )
          FROM ${studentProfileAttachment}
          WHERE ${studentProfileAttachment.profilePk} = ${studentProfile.pk}
        )`.as("attachments"),
      })
      .from(studentProfile)
      .innerJoin(department, eq(department.pk, studentProfile.departmentPk))
      .where(eq(studentProfile.studentPk, student.pk))
      .orderBy(desc(studentProfile.version))
      .limit(1)
      .as("latest");

    const [row] = await db
      .select({
        student,
        latest: {
          pk: latest.pk,
          studentPk: latest.studentPk,
          version: latest.version,
          departmentPk: latest.departmentPk,
          interests: latest.interests,
          activities: latest.activities,
          createdAt: latest.createdAt,
          departmentName: latest.departmentName,
          attachments: latest.attachments,
        },
      })
      .from(student)
      .leftJoinLateral(latest, sql`true`)
      .where(eq(student.userPk, userPk));
    if (!row) return null;

    // LEFT JOIN이라 프로필이 없으면 latest가 null
    const l = row.latest;
    return {
      student: row.student,
      latest: l?.pk
        ? {
            profile: {
              pk: l.pk,
              studentPk: l.studentPk,
              version: l.version,
              departmentPk: l.departmentPk,
              interests: l.interests,
              activities: l.activities,
              createdAt: l.createdAt,
            },
            department: { pk: l.departmentPk, name: l.departmentName },
            attachments: l.attachments,
          }
        : null,
    };
  }

  /*
  UPDATE student SET email = NULL, updated_at = now() WHERE user_pk = ?1;
   */
  // 회원 탈퇴: 학교 이메일 UQ를 풀어서 같은 이메일로 다시 가입할 수 있게 함
  async clearEmailByUserPk(userPk: string, tx: TxType): Promise<void> {
    await tx
      .update(student)
      .set({ email: null, updatedAt: new Date() })
      .where(eq(student.userPk, userPk));
  }

  /*
  DELETE FROM student WHERE pk = ?1;
   */
  // FK cascade가 없으므로 인증 요청 · 프로필 첨부 · 프로필을 먼저 지운 뒤 호출
  async deleteByPk(studentPk: string, tx: TxType): Promise<void> {
    await tx.delete(student).where(eq(student.pk, studentPk));
  }
}
