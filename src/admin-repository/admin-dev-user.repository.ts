import { Injectable } from "@nestjs/common";
import { count, desc, eq, inArray, or } from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { coffeeChatContact } from "@drizzle/schema/coffee-chat-contact";
import { coffeeChatRequest } from "@drizzle/schema/coffee-chat-request";
import { graduated } from "@drizzle/schema/graduated";
import { graduatedProfile } from "@drizzle/schema/graduated-profile";
import { notificationLog } from "@drizzle/schema/notification-log";
import { refreshToken } from "@drizzle/schema/refresh-token";
import { student } from "@drizzle/schema/student";
import { studentEmailSendLog } from "@drizzle/schema/student-email-send-log";
import { studentEmailVerification } from "@drizzle/schema/student-email-verification";
import { studentProfile } from "@drizzle/schema/student-profile";
import { studentProfileAttachment } from "@drizzle/schema/student-profile-attachment";
import { userConsent } from "@drizzle/schema/user-consent";
import { userOauthAccount } from "@drizzle/schema/user-oauth-account";
import { users } from "@drizzle/schema/users";

export type AdminDevUserRow = Pick<
  typeof users.$inferSelect,
  | "pk"
  | "type"
  | "status"
  | "isDeleted"
  | "withdrawRequestedAt"
  | "name"
  | "email"
  | "createdAt"
>;

export type AdminDevUserPage = {
  rows: AdminDevUserRow[];
  total: number;
};

// 개발용 회원 완전탈퇴 (CRB-72, DEV_USER_DELETE_ENABLED인 환경에서만 호출됨).
// 유저를 참조하는 테이블을 여기서 전부 지움. users를 참조하는 테이블을 추가하면 hardDelete에도 추가해야 users 삭제가 FK로 실패하지 않음
@Injectable()
export class AdminDevUserRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  SELECT pk, type, status, is_deleted, withdraw_requested_at, name, email, created_at
  FROM users ORDER BY created_at DESC, pk LIMIT ?1 OFFSET ?2;
  SELECT count(*) FROM users;
   */
  // 탈퇴 처리가 끝난(is_deleted) 유저도 행이 남아 있어 같이 보여 줌
  async findPage(offset: number, limit: number): Promise<AdminDevUserPage> {
    const db = this.dbService.db;
    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          pk: users.pk,
          type: users.type,
          status: users.status,
          isDeleted: users.isDeleted,
          withdrawRequestedAt: users.withdrawRequestedAt,
          name: users.name,
          email: users.email,
          createdAt: users.createdAt,
        })
        .from(users)
        // 같은 값이 있어도 페이지 사이 순서가 흔들리지 않게 pk를 마지막 기준으로
        .orderBy(desc(users.createdAt), users.pk)
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(users),
    ]);

    return { rows, total };
  }

  /*
  SELECT pk FROM users WHERE pk = ?1 FOR UPDATE;
  SELECT pk FROM student WHERE user_pk = ?1;
  SELECT pk FROM graduated WHERE user_pk = ?1;
  DELETE FROM notification_log WHERE coffee_chat_request_pk IN
    (SELECT pk FROM coffee_chat_request WHERE student_pk IN (?2) OR graduated_pk IN (?3));
  DELETE FROM coffee_chat_request WHERE student_pk IN (?2) OR graduated_pk IN (?3);
  DELETE FROM student_profile_attachment
    WHERE profile_pk IN (SELECT pk FROM student_profile WHERE student_pk IN (?2)) RETURNING source, url;
  DELETE FROM student_profile WHERE student_pk IN (?2);
  DELETE FROM student_email_verification WHERE student_pk IN (?2);
  DELETE FROM student WHERE user_pk = ?1;
  DELETE FROM graduated_profile WHERE graduated_pk IN (?3);
  DELETE FROM graduated WHERE user_pk = ?1 RETURNING business_card_key;
  DELETE FROM user_consent / user_oauth_account / refresh_token / coffee_chat_contact / student_email_send_log WHERE user_pk = ?1;
  DELETE FROM users WHERE pk = ?1;
   */
  // FK가 모두 NO ACTION이라 자식 테이블부터 지움. 유저가 없으면 null, 지웠으면 커밋 뒤 S3에서 지울 key.
  // 이 유저가 보냈거나 받은 커피챗 요청은 상대방 기록에서도 사라짐.
  // 유형을 바꾼 유저는 student · graduated 행이 둘 다 있을 수 있어 type과 상관없이 둘 다 지움
  async hardDelete(userPk: string, tx: TxType): Promise<string[] | null> {
    // 로그인 · 탈퇴 요청 · 탈퇴 만료 처리와 같은 유저 행 잠금으로 직렬화
    const [user] = await tx
      .select({ pk: users.pk })
      .from(users)
      .where(eq(users.pk, userPk))
      .for("update");
    if (!user) return null;

    const studentPks = (
      await tx
        .select({ pk: student.pk })
        .from(student)
        .where(eq(student.userPk, userPk))
    ).map((row) => row.pk);
    const graduatedPks = (
      await tx
        .select({ pk: graduated.pk })
        .from(graduated)
        .where(eq(graduated.userPk, userPk))
    ).map((row) => row.pk);

    const requestOfUser = or(
      inArray(coffeeChatRequest.studentPk, studentPks),
      inArray(coffeeChatRequest.graduatedPk, graduatedPks),
    );
    await tx
      .delete(notificationLog)
      .where(
        inArray(
          notificationLog.coffeeChatRequestPk,
          tx
            .select({ pk: coffeeChatRequest.pk })
            .from(coffeeChatRequest)
            .where(requestOfUser),
        ),
      );
    await tx.delete(coffeeChatRequest).where(requestOfUser);

    const attachments = await tx
      .delete(studentProfileAttachment)
      .where(
        inArray(
          studentProfileAttachment.profilePk,
          tx
            .select({ pk: studentProfile.pk })
            .from(studentProfile)
            .where(inArray(studentProfile.studentPk, studentPks)),
        ),
      )
      .returning({
        source: studentProfileAttachment.source,
        url: studentProfileAttachment.url,
      });
    await tx
      .delete(studentProfile)
      .where(inArray(studentProfile.studentPk, studentPks));
    await tx
      .delete(studentEmailVerification)
      .where(inArray(studentEmailVerification.studentPk, studentPks));
    await tx.delete(student).where(eq(student.userPk, userPk));

    await tx
      .delete(graduatedProfile)
      .where(inArray(graduatedProfile.graduatedPk, graduatedPks));
    const graduatedRows = await tx
      .delete(graduated)
      .where(eq(graduated.userPk, userPk))
      .returning({ businessCardKey: graduated.businessCardKey });

    await tx.delete(userConsent).where(eq(userConsent.userPk, userPk));
    await tx
      .delete(userOauthAccount)
      .where(eq(userOauthAccount.userPk, userPk));
    await tx.delete(refreshToken).where(eq(refreshToken.userPk, userPk));
    await tx
      .delete(coffeeChatContact)
      .where(eq(coffeeChatContact.userPk, userPk));
    await tx
      .delete(studentEmailSendLog)
      .where(eq(studentEmailSendLog.userPk, userPk));
    await tx.delete(users).where(eq(users.pk, userPk));

    // 프로필 버전끼리 같은 첨부 파일을 참조하므로 중복을 뺌. link 첨부의 url은 외부 주소라 지우지 않음
    const keys = [
      ...attachments
        .filter((row) => row.source === "file")
        .map((row) => row.url),
      ...graduatedRows.flatMap((row) =>
        row.businessCardKey ? [row.businessCardKey] : [],
      ),
    ];
    return [...new Set(keys)];
  }
}
