import { Injectable } from "@nestjs/common";
import { and, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { CheersDBError } from "@src/global/exceptions/cheers-db.error";
import { coffeeChatRequest } from "@drizzle/schema/coffee-chat-request";
import { coffeeChatContact } from "@drizzle/schema/coffee-chat-contact";
import { department } from "@drizzle/schema/department";
import { student } from "@drizzle/schema/student";
import { studentProfile } from "@drizzle/schema/student-profile";
import { studentProfileAttachment } from "@drizzle/schema/student-profile-attachment";
import { graduated } from "@drizzle/schema/graduated";
import { graduatedProfile } from "@drizzle/schema/graduated-profile";
import { users } from "@drizzle/schema/users";
import { CoffeeChatContactRow } from "./coffee-chat-contact.repository";
import { StudentAttachment } from "./student.repository";
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
  // 현업자가 사용 중인 계정 (탈퇴 · 탈퇴 유예기간 중이면 false)
  graduatedActive: boolean;
};

export type SentRequestDetailRow = SentRequestRow &
  Pick<
    CoffeeChatRequestRow,
    "studentViewedAt" | "sharedEmail" | "sharedPhone"
  > & {
    // 현업자 이름 (탈퇴 처리 후에는 null)
    graduatedName: string | null;
  };

export type SentRequestPage = {
  rows: SentRequestRow[];
  total: number;
};

export type ReceivedRequestRow = Pick<
  CoffeeChatRequestRow,
  "pk" | "createdAt" | "graduatedViewedAt" | "contactSharedAt"
> & {
  // 재학생 이름 (탈퇴 처리 후에는 null)
  studentName: string | null;
  // 재학생이 사용 중인 계정 (탈퇴 · 탈퇴 유예기간 중이면 false)
  studentActive: boolean;
  // 요청 당시 학과
  departmentName: string;
};

export type ReceivedRequestPage = {
  rows: ReceivedRequestRow[];
  total: number;
};

// 재학생의 현재 연락 설정 (탈퇴 처리 후에는 행이 지워져 null)
export type StudentContact = Pick<
  CoffeeChatContactRow,
  "kakaoEnabled" | "emailEnabled" | "phone" | "email"
>;

export type ReceivedRequestDetailRow = ReceivedRequestRow &
  Pick<CoffeeChatRequestRow, "message"> & {
    // 요청 당시 버전
    interests: string[];
    activities: string[] | null;
    attachments: StudentAttachment[];
    studentContact: StudentContact | null;
  };

export type ReceivedRequestForShareRow = Pick<
  CoffeeChatRequestRow,
  "pk" | "contactSharedAt" | "sharedEmail" | "sharedPhone"
> & {
  studentName: string | null;
  studentActive: boolean;
  studentContact: StudentContact | null;
};

// 내가(현업자 user_pk) 받은 요청
const isReceivedBy = (graduatedUserPk: string) =>
  and(
    eq(graduated.pk, coffeeChatRequest.graduatedPk),
    eq(graduated.userPk, graduatedUserPk),
  );

const studentContactColumns = {
  kakaoEnabled: coffeeChatContact.kakaoEnabled,
  emailEnabled: coffeeChatContact.emailEnabled,
  phone: coffeeChatContact.phone,
  email: coffeeChatContact.email,
};

const receivedRequestColumns = {
  pk: coffeeChatRequest.pk,
  createdAt: coffeeChatRequest.createdAt,
  graduatedViewedAt: coffeeChatRequest.graduatedViewedAt,
  contactSharedAt: coffeeChatRequest.contactSharedAt,
  studentName: users.name,
  studentActive: sql<boolean>`${isActiveAccount}`,
  departmentName: department.name,
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
  graduatedActive: sql<boolean>`${isActiveAccount}`,
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
    gp.graduated_pk, gp.nickname, gp.company, gp.job,
    (u.is_deleted = false AND u.withdraw_requested_at IS NULL) AS graduated_active
  FROM coffee_chat_request r
  JOIN student s ON s.pk = r.student_pk AND s.user_pk = ?1
  JOIN graduated_profile gp ON gp.graduated_pk = r.graduated_pk
  JOIN graduated g ON g.pk = r.graduated_pk
  JOIN users u ON u.pk = g.user_pk
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
        .innerJoin(graduated, eq(graduated.pk, coffeeChatRequest.graduatedPk))
        .innerJoin(users, eq(users.pk, graduated.userPk))
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

  /*
  SELECT r.pk, r.created_at, r.graduated_viewed_at, r.contact_shared_at, u.name, d.name,
    (u.is_deleted = false AND u.withdraw_requested_at IS NULL) AS student_active
  FROM coffee_chat_request r
  JOIN graduated g ON g.pk = r.graduated_pk AND g.user_pk = ?1
  JOIN student_profile sp ON sp.pk = r.student_profile_pk
  JOIN department d ON d.pk = sp.department_pk
  JOIN student s ON s.pk = r.student_pk
  JOIN users u ON u.pk = s.user_pk
  ORDER BY r.created_at DESC, r.pk DESC LIMIT ?2 OFFSET ?3;
  SELECT count(*) FROM coffee_chat_request r JOIN graduated g ON g.pk = r.graduated_pk AND g.user_pk = ?1;
   */
  // 받은 요청 목록 (최근 요청 순). 상대 재학생이 탈퇴했어도 기록은 보여 줌 (student · 프로필 보관)
  async findReceivedPage(
    graduatedUserPk: string,
    offset: number,
    limit: number,
  ): Promise<ReceivedRequestPage> {
    const db = this.dbService.db;
    const [rows, [{ total }]] = await Promise.all([
      db
        .select(receivedRequestColumns)
        .from(coffeeChatRequest)
        .innerJoin(graduated, isReceivedBy(graduatedUserPk))
        .innerJoin(
          studentProfile,
          eq(studentProfile.pk, coffeeChatRequest.studentProfilePk),
        )
        .innerJoin(department, eq(department.pk, studentProfile.departmentPk))
        .innerJoin(student, eq(student.pk, coffeeChatRequest.studentPk))
        .innerJoin(users, eq(users.pk, student.userPk))
        .orderBy(desc(coffeeChatRequest.createdAt), desc(coffeeChatRequest.pk))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(coffeeChatRequest)
        .innerJoin(graduated, isReceivedBy(graduatedUserPk)),
    ]);

    return { rows, total };
  }

  /*
  SELECT r.pk, r.message, r.created_at, r.graduated_viewed_at, r.contact_shared_at, u.name, d.name,
    (u.is_deleted = false AND u.withdraw_requested_at IS NULL) AS student_active,
    sp.interests, sp.activities, c.kakao_enabled, c.email_enabled, c.phone, c.email,
    (SELECT COALESCE(json_agg(json_build_object('kind', a.kind, 'source', a.source,
              'url', a.url, 'fileName', a.file_name) ORDER BY a.sort_order), '[]')
     FROM student_profile_attachment a WHERE a.profile_pk = sp.pk) AS attachments
  FROM coffee_chat_request r
  JOIN graduated g ON g.pk = r.graduated_pk AND g.user_pk = ?2
  JOIN student_profile sp ON sp.pk = r.student_profile_pk
  JOIN department d ON d.pk = sp.department_pk
  JOIN student s ON s.pk = r.student_pk
  JOIN users u ON u.pk = s.user_pk
  LEFT JOIN coffee_chat_contact c ON c.user_pk = s.user_pk
  WHERE r.pk = ?1;
   */
  // 받은 요청 상세: 프로필은 요청 당시 버전, 연락처는 현재 값. 다른 현업자의 요청이면 null
  async findReceivedByPk(
    pk: string,
    graduatedUserPk: string,
    tx?: TxType,
  ): Promise<ReceivedRequestDetailRow | null> {
    const result = await (tx ?? this.dbService.db)
      .select({
        ...receivedRequestColumns,
        message: coffeeChatRequest.message,
        interests: studentProfile.interests,
        activities: studentProfile.activities,
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
        )`,
        studentContact: studentContactColumns,
      })
      .from(coffeeChatRequest)
      .innerJoin(graduated, isReceivedBy(graduatedUserPk))
      .innerJoin(
        studentProfile,
        eq(studentProfile.pk, coffeeChatRequest.studentProfilePk),
      )
      .innerJoin(department, eq(department.pk, studentProfile.departmentPk))
      .innerJoin(student, eq(student.pk, coffeeChatRequest.studentPk))
      .innerJoin(users, eq(users.pk, student.userPk))
      .leftJoin(coffeeChatContact, eq(coffeeChatContact.userPk, student.userPk))
      .where(eq(coffeeChatRequest.pk, pk));

    return result[0] ?? null;
  }

  /*
  SELECT r.pk, r.contact_shared_at, r.shared_email, r.shared_phone, u.name,
    (u.is_deleted = false AND u.withdraw_requested_at IS NULL) AS student_active,
    c.kakao_enabled, c.email_enabled, c.phone, c.email
  FROM coffee_chat_request r
  JOIN graduated g ON g.pk = r.graduated_pk AND g.user_pk = ?2
  JOIN student s ON s.pk = r.student_pk
  JOIN users u ON u.pk = s.user_pk
  LEFT JOIN coffee_chat_contact c ON c.user_pk = s.user_pk
  WHERE r.pk = ?1
  FOR UPDATE OF r;
   */
  // 연락처 공유: 요청 행을 잠가 동시에 두 번 호출해도 알림이 한 번만 나가게 함. 다른 현업자의 요청이면 null
  async findReceivedForShare(
    pk: string,
    graduatedUserPk: string,
    tx: TxType,
  ): Promise<ReceivedRequestForShareRow | null> {
    const result = await tx
      .select({
        pk: coffeeChatRequest.pk,
        contactSharedAt: coffeeChatRequest.contactSharedAt,
        sharedEmail: coffeeChatRequest.sharedEmail,
        sharedPhone: coffeeChatRequest.sharedPhone,
        studentName: users.name,
        studentActive: sql<boolean>`${isActiveAccount}`,
        studentContact: studentContactColumns,
      })
      .from(coffeeChatRequest)
      .innerJoin(graduated, isReceivedBy(graduatedUserPk))
      .innerJoin(student, eq(student.pk, coffeeChatRequest.studentPk))
      .innerJoin(users, eq(users.pk, student.userPk))
      .leftJoin(coffeeChatContact, eq(coffeeChatContact.userPk, student.userPk))
      .where(eq(coffeeChatRequest.pk, pk))
      .for("update", { of: coffeeChatRequest });

    return result[0] ?? null;
  }

  /*
  UPDATE coffee_chat_request SET graduated_viewed_at = now(), updated_at = now()
  WHERE pk = ?1 AND graduated_viewed_at IS NULL;
   */
  // 현업자가 처음 확인한 시각만 남김 (이미 있으면 덮어쓰지 않음)
  async markGraduatedViewed(pk: string, tx: TxType): Promise<void> {
    const now = new Date();
    await tx
      .update(coffeeChatRequest)
      .set({ graduatedViewedAt: now, updatedAt: now })
      .where(
        and(
          eq(coffeeChatRequest.pk, pk),
          isNull(coffeeChatRequest.graduatedViewedAt),
        ),
      );
  }

  /*
  UPDATE coffee_chat_request
  SET contact_shared_at = now(), shared_email = ?2, shared_phone = ?3, updated_at = now()
  WHERE pk = ?1 RETURNING contact_shared_at;
   */
  // 공유 시점의 연락처를 저장. findReceivedForShare로 행을 잠그고 아직 공유 전임을 확인한 뒤 호출
  async markContactShared(
    pk: string,
    contact: Pick<CoffeeChatRequestRow, "sharedEmail" | "sharedPhone">,
    tx: TxType,
  ): Promise<Date> {
    const now = new Date();
    const result = await tx
      .update(coffeeChatRequest)
      .set({ contactSharedAt: now, updatedAt: now, ...contact })
      .where(eq(coffeeChatRequest.pk, pk))
      .returning({ contactSharedAt: coffeeChatRequest.contactSharedAt });

    if (result.length === 0 || !result[0].contactSharedAt) {
      throw new CheersDBError("Failed to mark contact shared");
    }

    return result[0].contactSharedAt;
  }
}
