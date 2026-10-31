import { Injectable } from "@nestjs/common";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lt,
  SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DatabaseService } from "@src/database/database.service";
import { isActiveAccountAs } from "@src/database/repository/user.sql";
import { CoffeeChatRequestStatus } from "@src/cheers/cheers.utils";
import { coffeeChatRequest } from "@drizzle/schema/coffee-chat-request";
import { department } from "@drizzle/schema/department";
import { graduated } from "@drizzle/schema/graduated";
import { graduatedProfile } from "@drizzle/schema/graduated-profile";
import { student } from "@drizzle/schema/student";
import { studentProfile } from "@drizzle/schema/student-profile";
import { users } from "@drizzle/schema/users";

type CoffeeChatRequestRow = typeof coffeeChatRequest.$inferSelect;

export type AdminCoffeeChatRequestRow = Pick<
  CoffeeChatRequestRow,
  | "pk"
  | "message"
  | "createdAt"
  | "graduatedViewedAt"
  | "contactSharedAt"
  | "studentViewedAt"
> & {
  student: {
    pk: string;
    // 탈퇴 처리 후에는 null
    name: string | null;
    // 요청 당시 학과
    department: string;
    active: boolean;
  };
  graduated: {
    pk: string;
    nickname: string;
    company: string;
    job: string;
    active: boolean;
  };
};

export type AdminCoffeeChatRequestFilter = {
  status?: CoffeeChatRequestStatus;
  // 요청 시각 [createdFrom, createdTo)
  createdFrom?: Date;
  createdTo?: Date;
  studentPk?: string;
  studentName?: string;
  graduatedPk?: string;
  graduatedNickname?: string;
};

export type AdminCoffeeChatRequestPage = {
  rows: AdminCoffeeChatRequestRow[];
  total: number;
};

const studentUser = alias(users, "student_user");
const graduatedUser = alias(users, "graduated_user");

// shared_phone · shared_email은 어드민에 노출하지 않으므로 읽지도 않음
const requestColumns = {
  pk: coffeeChatRequest.pk,
  message: coffeeChatRequest.message,
  createdAt: coffeeChatRequest.createdAt,
  graduatedViewedAt: coffeeChatRequest.graduatedViewedAt,
  contactSharedAt: coffeeChatRequest.contactSharedAt,
  studentViewedAt: coffeeChatRequest.studentViewedAt,
  student: {
    pk: coffeeChatRequest.studentPk,
    name: studentUser.name,
    department: department.name,
    active: sql<boolean>`${isActiveAccountAs("student_user")}`,
  },
  graduated: {
    pk: coffeeChatRequest.graduatedPk,
    nickname: graduatedProfile.nickname,
    company: graduatedProfile.company,
    job: graduatedProfile.job,
    active: sql<boolean>`${isActiveAccountAs("graduated_user")}`,
  },
};

// 검색어의 %, _를 글자 그대로 찾도록 처리
const containsPattern = (keyword: string) =>
  `%${keyword.replace(/[\\%_]/g, "\\$&")}%`;

// 진행 단계는 처음 일어난 시각 컬럼으로 계산 (toRequestStatus와 같은 기준)
const STATUS_CONDITIONS: Record<CoffeeChatRequestStatus, SQL | undefined> = {
  requested: and(
    isNull(coffeeChatRequest.graduatedViewedAt),
    isNull(coffeeChatRequest.contactSharedAt),
  ),
  viewed: and(
    isNotNull(coffeeChatRequest.graduatedViewedAt),
    isNull(coffeeChatRequest.contactSharedAt),
  ),
  contact_shared: isNotNull(coffeeChatRequest.contactSharedAt),
};

const toConditions = (filter: AdminCoffeeChatRequestFilter): SQL | undefined =>
  and(
    filter.status && STATUS_CONDITIONS[filter.status],
    filter.createdFrom && gte(coffeeChatRequest.createdAt, filter.createdFrom),
    filter.createdTo && lt(coffeeChatRequest.createdAt, filter.createdTo),
    filter.studentPk
      ? eq(coffeeChatRequest.studentPk, filter.studentPk)
      : undefined,
    filter.studentName
      ? ilike(studentUser.name, containsPattern(filter.studentName))
      : undefined,
    filter.graduatedPk
      ? eq(coffeeChatRequest.graduatedPk, filter.graduatedPk)
      : undefined,
    filter.graduatedNickname
      ? ilike(
          graduatedProfile.nickname,
          containsPattern(filter.graduatedNickname),
        )
      : undefined,
  );

@Injectable()
export class AdminCoffeeChatRequestRepository {
  constructor(private readonly dbService: DatabaseService) {}

  // 탈퇴해도 student · graduated · 프로필 행은 남으므로 inner join으로 요청이 빠지지 않음
  private selectRequests() {
    return this.dbService.db
      .select(requestColumns)
      .from(coffeeChatRequest)
      .innerJoin(student, eq(student.pk, coffeeChatRequest.studentPk))
      .innerJoin(studentUser, eq(studentUser.pk, student.userPk))
      .innerJoin(
        studentProfile,
        eq(studentProfile.pk, coffeeChatRequest.studentProfilePk),
      )
      .innerJoin(department, eq(department.pk, studentProfile.departmentPk))
      .innerJoin(graduated, eq(graduated.pk, coffeeChatRequest.graduatedPk))
      .innerJoin(graduatedUser, eq(graduatedUser.pk, graduated.userPk))
      .innerJoin(
        graduatedProfile,
        eq(graduatedProfile.graduatedPk, coffeeChatRequest.graduatedPk),
      );
  }

  /*
  SELECT r.pk, r.message, r.created_at, r.graduated_viewed_at, r.contact_shared_at, r.student_viewed_at,
    r.student_pk, su.name, d.name, (su.is_deleted = false AND su.withdraw_requested_at IS NULL),
    r.graduated_pk, gp.nickname, gp.company, gp.job, (gu.is_deleted = false AND gu.withdraw_requested_at IS NULL)
  FROM coffee_chat_request r
  JOIN student s ON s.pk = r.student_pk
  JOIN users su ON su.pk = s.user_pk
  JOIN student_profile sp ON sp.pk = r.student_profile_pk
  JOIN department d ON d.pk = sp.department_pk
  JOIN graduated g ON g.pk = r.graduated_pk
  JOIN users gu ON gu.pk = g.user_pk
  JOIN graduated_profile gp ON gp.graduated_pk = r.graduated_pk
  WHERE <filter>
  ORDER BY r.created_at DESC, r.pk DESC LIMIT ?1 OFFSET ?2;
  SELECT count(*) FROM coffee_chat_request r
  JOIN student s ON s.pk = r.student_pk
  JOIN users su ON su.pk = s.user_pk
  JOIN graduated_profile gp ON gp.graduated_pk = r.graduated_pk
  WHERE <filter>;
   */
  async findPage(
    filter: AdminCoffeeChatRequestFilter,
    offset: number,
    limit: number,
  ): Promise<AdminCoffeeChatRequestPage> {
    const where = toConditions(filter);
    const [rows, [{ total }]] = await Promise.all([
      this.selectRequests()
        .where(where)
        .orderBy(desc(coffeeChatRequest.createdAt), desc(coffeeChatRequest.pk))
        .limit(limit)
        .offset(offset),
      // 필터에 쓰는 테이블만 join. 나머지 join은 FK로 행 수가 변하지 않음
      this.dbService.db
        .select({ total: count() })
        .from(coffeeChatRequest)
        .innerJoin(student, eq(student.pk, coffeeChatRequest.studentPk))
        .innerJoin(studentUser, eq(studentUser.pk, student.userPk))
        .innerJoin(
          graduatedProfile,
          eq(graduatedProfile.graduatedPk, coffeeChatRequest.graduatedPk),
        )
        .where(where),
    ]);

    return { rows, total };
  }

  /*
  findPage와 같은 SELECT, WHERE r.pk = ?1;
   */
  async findByPk(pk: string): Promise<AdminCoffeeChatRequestRow | null> {
    const result = await this.selectRequests().where(
      eq(coffeeChatRequest.pk, pk),
    );

    return result[0] ?? null;
  }
}
