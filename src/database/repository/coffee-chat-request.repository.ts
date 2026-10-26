import { Injectable } from "@nestjs/common";
import { and, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { CheersDBError } from "@src/global/exceptions/cheers-db.error";
import { coffeeChatRequest } from "../../../drizzle/schema/coffee-chat-request";
import { student } from "../../../drizzle/schema/student";
import { graduated } from "../../../drizzle/schema/graduated";
import { graduatedProfile } from "../../../drizzle/schema/graduated-profile";
import { users } from "../../../drizzle/schema/users";
import { isActiveAccount } from "./user.sql";

export type CoffeeChatRequestRow = typeof coffeeChatRequest.$inferSelect;

export type SentRequestRow = Pick<
  CoffeeChatRequestRow,
  "pk" | "message" | "createdAt" | "graduatedViewedAt" | "contactSharedAt"
> & {
  graduated: {
    graduatedPk: string;
    nickname: string;
    company: string;
    job: string;
  };
};

export type SentRequestDetailRow = SentRequestRow &
  Pick<
    CoffeeChatRequestRow,
    "studentViewedAt" | "sharedEmail" | "sharedPhone"
  > & {
    // 현업자 이름 (탈퇴 처리 후에는 null)
    graduatedName: string | null;
    // 현업자가 사용 중인 계정 (탈퇴 · 탈퇴 유예기간 중이면 false)
    graduatedActive: boolean;
  };

export type SentRequestPage = {
  rows: SentRequestRow[];
  total: number;
};

// 내가(재학생 user_pk) 보낸 요청
const isSentBy = (studentUserPk: string) =>
  and(
    eq(student.pk, coffeeChatRequest.studentPk),
    eq(student.userPk, studentUserPk),
  );

const sentRequestColumns = {
  pk: coffeeChatRequest.pk,
  message: coffeeChatRequest.message,
  createdAt: coffeeChatRequest.createdAt,
  graduatedViewedAt: coffeeChatRequest.graduatedViewedAt,
  contactSharedAt: coffeeChatRequest.contactSharedAt,
  graduated: {
    graduatedPk: graduatedProfile.graduatedPk,
    nickname: graduatedProfile.nickname,
    company: graduatedProfile.company,
    job: graduatedProfile.job,
  },
};

@Injectable()
export class CoffeeChatRequestRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
  INSERT INTO coffee_chat_request (pk, graduated_pk, student_pk, student_profile_pk, message)
  VALUES (?1, ?2, ?3, ?4, ?5) RETURNING *;
   */
  // 요청 당시의 재학생 정보 버전을 저장. 복합 FK (student_profile_pk, student_pk)로 본인 버전만 들어감
  async insert(
    row: Pick<
      CoffeeChatRequestRow,
      "graduatedPk" | "studentPk" | "studentProfilePk" | "message"
    >,
    tx: TxType,
  ): Promise<CoffeeChatRequestRow> {
    const result = await tx
      .insert(coffeeChatRequest)
      .values({ pk: randomUUID(), ...row })
      .returning();

    if (result.length === 0) {
      throw new CheersDBError("Failed to insert coffee chat request");
    }

    return result[0];
  }

  /*
  SELECT r.pk, r.message, r.created_at, r.graduated_viewed_at, r.contact_shared_at,
    gp.graduated_pk, gp.nickname, gp.company, gp.job
  FROM coffee_chat_request r
  JOIN student s ON s.pk = r.student_pk AND s.user_pk = ?1
  JOIN graduated_profile gp ON gp.graduated_pk = r.graduated_pk
  ORDER BY r.created_at DESC, r.pk DESC LIMIT ?2 OFFSET ?3;
  SELECT count(*) FROM coffee_chat_request r JOIN student s ON s.pk = r.student_pk AND s.user_pk = ?1;
   */
  // 보낸 요청 목록 (최근 요청 순). 상대 현업자가 탈퇴했어도 기록은 보여 줌 (graduated_profile 보관)
  async findSentPage(
    studentUserPk: string,
    offset: number,
    limit: number,
  ): Promise<SentRequestPage> {
    const db = this.dbService.db;
    const [rows, [{ total }]] = await Promise.all([
      db
        .select(sentRequestColumns)
        .from(coffeeChatRequest)
        .innerJoin(student, isSentBy(studentUserPk))
        .innerJoin(
          graduatedProfile,
          eq(graduatedProfile.graduatedPk, coffeeChatRequest.graduatedPk),
        )
        .orderBy(desc(coffeeChatRequest.createdAt), desc(coffeeChatRequest.pk))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(coffeeChatRequest)
        .innerJoin(student, isSentBy(studentUserPk)),
    ]);

    return { rows, total };
  }

  /*
  SELECT r.*, gp.graduated_pk, gp.nickname, gp.company, gp.job, u.name,
    (u.is_deleted = false AND u.withdraw_requested_at IS NULL) AS graduated_active
  FROM coffee_chat_request r
  JOIN student s ON s.pk = r.student_pk AND s.user_pk = ?2
  JOIN graduated_profile gp ON gp.graduated_pk = r.graduated_pk
  JOIN graduated g ON g.pk = r.graduated_pk
  JOIN users u ON u.pk = g.user_pk
  WHERE r.pk = ?1;
   */
  // 보낸 요청 상세. 다른 재학생의 요청이면 null
  async findSentByPk(
    pk: string,
    studentUserPk: string,
    tx?: TxType,
  ): Promise<SentRequestDetailRow | null> {
    const result = await (tx ?? this.dbService.db)
      .select({
        ...sentRequestColumns,
        studentViewedAt: coffeeChatRequest.studentViewedAt,
        sharedEmail: coffeeChatRequest.sharedEmail,
        sharedPhone: coffeeChatRequest.sharedPhone,
        graduatedName: users.name,
        graduatedActive: sql<boolean>`${isActiveAccount}`,
      })
      .from(coffeeChatRequest)
      .innerJoin(student, isSentBy(studentUserPk))
      .innerJoin(
        graduatedProfile,
        eq(graduatedProfile.graduatedPk, coffeeChatRequest.graduatedPk),
      )
      .innerJoin(graduated, eq(graduated.pk, coffeeChatRequest.graduatedPk))
      .innerJoin(users, eq(users.pk, graduated.userPk))
      .where(eq(coffeeChatRequest.pk, pk));

    return result[0] ?? null;
  }

  /*
  UPDATE coffee_chat_request SET student_viewed_at = now(), updated_at = now()
  WHERE pk = ?1 AND contact_shared_at IS NOT NULL AND student_viewed_at IS NULL;
   */
  // 공유받은 연락처를 처음 확인한 시각만 남김 (이미 있으면 덮어쓰지 않음)
  async markStudentViewed(pk: string, tx: TxType): Promise<void> {
    const now = new Date();
    await tx
      .update(coffeeChatRequest)
      .set({ studentViewedAt: now, updatedAt: now })
      .where(
        and(
          eq(coffeeChatRequest.pk, pk),
          isNotNull(coffeeChatRequest.contactSharedAt),
          isNull(coffeeChatRequest.studentViewedAt),
        ),
      );
  }
}
