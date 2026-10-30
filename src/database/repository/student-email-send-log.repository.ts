import { Injectable } from "@nestjs/common";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { TxType } from "@src/global/types/tx.types";
import { studentEmailSendLog } from "../../../drizzle/schema/student-email-send-log";

export type StudentEmailSendLogRow = typeof studentEmailSendLog.$inferSelect;

@Injectable()
export class StudentEmailSendLogRepository {
  /*
  SELECT * FROM student_email_send_log WHERE user_pk = ?1 AND created_at > ?2 ORDER BY created_at;
   */
  async findRecentByUserPk(
    userPk: string,
    since: Date,
    tx: TxType,
  ): Promise<StudentEmailSendLogRow[]> {
    return tx
      .select()
      .from(studentEmailSendLog)
      .where(
        and(
          eq(studentEmailSendLog.userPk, userPk),
          gt(studentEmailSendLog.createdAt, since),
        ),
      )
      .orderBy(asc(studentEmailSendLog.createdAt));
  }

  /*
  SELECT * FROM student_email_send_log WHERE email = ?1 AND created_at > ?2 ORDER BY created_at;
   */
  // 모든 계정의 기록. 메일 폭탄 · 여러 계정을 쓰는 대입 방지
  async findRecentByEmail(
    email: string,
    since: Date,
    tx: TxType,
  ): Promise<StudentEmailSendLogRow[]> {
    return tx
      .select()
      .from(studentEmailSendLog)
      .where(
        and(
          eq(studentEmailSendLog.email, email),
          gt(studentEmailSendLog.createdAt, since),
        ),
      )
      .orderBy(asc(studentEmailSendLog.createdAt));
  }

  /*
  INSERT INTO student_email_send_log (pk, user_pk, email, created_at) VALUES (?1, ?2, ?3, ?4);
   */
  async insert(
    row: Pick<StudentEmailSendLogRow, "userPk" | "email" | "createdAt">,
    tx: TxType,
  ): Promise<void> {
    await tx.insert(studentEmailSendLog).values({ pk: randomUUID(), ...row });
  }

  /*
  UPDATE student_email_send_log SET failed_attempt_count = failed_attempt_count + 1
  WHERE user_pk = ?1 AND created_at = ?2;
   */
  // 인증코드 틀림. createdAt은 그 코드의 student_email_verification.created_at (전송 때 같은 값으로 저장).
  // 기록보다 먼저 전송된 코드는 대상 행이 없을 수 있어 0건이어도 예외를 던지지 않음
  async incrementFailedAttemptCount(
    userPk: string,
    createdAt: Date,
    tx: TxType,
  ): Promise<void> {
    await tx
      .update(studentEmailSendLog)
      .set({
        failedAttemptCount: sql`${studentEmailSendLog.failedAttemptCount} + 1`,
      })
      .where(
        and(
          eq(studentEmailSendLog.userPk, userPk),
          eq(studentEmailSendLog.createdAt, createdAt),
        ),
      );
  }

  /*
  DELETE FROM student_email_send_log WHERE user_pk = ?1;
   */
  // 회원 탈퇴: 입력한 gist 이메일이 남아 있어 같이 지움
  async deleteByUserPk(userPk: string, tx: TxType): Promise<void> {
    await tx
      .delete(studentEmailSendLog)
      .where(eq(studentEmailSendLog.userPk, userPk));
  }
}
