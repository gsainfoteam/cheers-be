import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { CheersDBError } from "@src/global/exceptions/cheers-db.error";
import { student } from "../../../drizzle/schema/student";

export type StudentRow = typeof student.$inferSelect;

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
