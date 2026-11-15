import { Injectable } from "@nestjs/common";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  lt,
  or,
  SQL,
  sql,
} from "drizzle-orm";
import { DatabaseService } from "@src/database/database.service";
import { isActiveAccount } from "@src/database/repository/user.sql";
import { isProfileCompany } from "@src/database/repository/company.sql";
import { coffeeChatContact } from "@drizzle/schema/coffee-chat-contact";
import { companyAlias } from "@drizzle/schema/company-alias";
import { department } from "@drizzle/schema/department";
import { graduated } from "@drizzle/schema/graduated";
import { graduatedProfile } from "@drizzle/schema/graduated-profile";
import { school } from "@drizzle/schema/school";
import { student } from "@drizzle/schema/student";
import { studentProfile } from "@drizzle/schema/student-profile";
import { userConsent } from "@drizzle/schema/user-consent";
import { userOauthAccount } from "@drizzle/schema/user-oauth-account";
import { users } from "@drizzle/schema/users";

type UserRow = typeof users.$inferSelect;

export type AdminUserWithdrawal = "none" | "requested" | "deleted";

export type AdminUserFilter = {
  type?: UserRow["type"];
  status?: UserRow["status"];
  withdrawal?: AdminUserWithdrawal;
  // pk(uuid 문자열) · 이름 · 이메일 부분 일치 (대소문자 무시)
  keyword?: string;
  // 가입 시각 [createdFrom, createdTo)
  createdFrom?: Date;
  createdTo?: Date;
};

export type AdminUserListRow = Pick<
  UserRow,
  | "pk"
  | "name"
  | "email"
  | "type"
  | "status"
  | "isDeleted"
  | "withdrawRequestedAt"
  | "createdAt"
  | "lastActiveAt"
> & {
  // 추가 정보 입력 전이면 모두 null
  school: string | null;
  department: string | null;
  company: string | null;
  job: string | null;
};

export type AdminUserPage = {
  rows: AdminUserListRow[];
  total: number;
};

export type AdminUserRow = Pick<
  UserRow,
  | "pk"
  | "name"
  | "email"
  | "type"
  | "status"
  | "isDeleted"
  | "withdrawRequestedAt"
  | "createdAt"
  | "updatedAt"
  | "lastActiveAt"
>;

// provider_sub(제공자 쪽 식별자)는 읽지 않음
export type AdminUserOauthAccountRow = Pick<
  typeof userOauthAccount.$inferSelect,
  "provider" | "email" | "createdAt" | "lastLoginAt"
>;

// phone · email 값은 읽지 않음. 값은 열람 기록을 남기는 findContactByUserPk로만 읽음
export type AdminUserContactFlagsRow = Pick<
  typeof coffeeChatContact.$inferSelect,
  "kakaoEnabled" | "emailEnabled"
>;

export type AdminUserContactRow = AdminUserContactFlagsRow &
  Pick<typeof coffeeChatContact.$inferSelect, "phone" | "email">;

export type AdminUserConsentRow = Pick<
  typeof userConsent.$inferSelect,
  "consentType" | "consentVersion" | "agreedAt" | "revokedAt"
>;

export type AdminUserStudentRow = {
  studentPk: string;
  schoolEmail: string | null;
  verifiedAt: Date | null;
  // 추가 정보 입력 전이면 null (가장 큰 version의 프로필)
  school: string | null;
  department: string | null;
  interests: string[] | null;
  activities: string[] | null;
  // 보낸 커피챗 요청 수
  requestCount: number;
};

export type AdminUserGraduatedRow = {
  graduatedPk: string;
  verifiedAt: Date | null;
  hasBusinessCard: boolean;
  // 추가 정보 입력 전이면 null
  nickname: string | null;
  company: string | null;
  department: string | null;
  job: string | null;
  hashtags: string[] | null;
  links: string[] | null;
  // 받은 커피챗 요청 수
  requestCount: number;
};

// 검색어의 %, _를 글자 그대로 찾도록 처리
const containsPattern = (keyword: string) =>
  `%${keyword.replace(/[\\%_]/g, "\\$&")}%`;

const WITHDRAWAL_CONDITIONS: Record<AdminUserWithdrawal, SQL> = {
  none: isActiveAccount,
  requested: and(
    eq(users.isDeleted, false),
    isNotNull(users.withdrawRequestedAt),
  )!,
  deleted: eq(users.isDeleted, true),
};

const toConditions = (filter: AdminUserFilter): SQL | undefined => {
  const pattern = filter.keyword && containsPattern(filter.keyword);
  return and(
    filter.type && eq(users.type, filter.type),
    filter.status && eq(users.status, filter.status),
    filter.withdrawal && WITHDRAWAL_CONDITIONS[filter.withdrawal],
    pattern
      ? or(
          ilike(sql`${users.pk}::text`, pattern),
          ilike(users.name, pattern),
          ilike(users.email, pattern),
        )
      : undefined,
    filter.createdFrom && gte(users.createdAt, filter.createdFrom),
    filter.createdTo && lt(users.createdAt, filter.createdTo),
  );
};

// 학생 프로필은 수정할 때마다 새 버전이 쌓이므로 가장 큰 version이 현재 값
const isLatestStudentProfile = and(
  eq(studentProfile.studentPk, student.pk),
  eq(
    studentProfile.version,
    sql`(SELECT max(sp.version) FROM student_profile sp WHERE sp.student_pk = ${student.pk})`,
  ),
);

@Injectable()
export class AdminUserRepository {
  constructor(private readonly dbService: DatabaseService) {}

  /*
    SELECT u.pk, u.name, u.email, u.type, u.status, u.is_deleted, u.withdraw_requested_at, u.created_at, u.last_active_at,
      sc.name, d.name, ca.name, gp.job
    FROM users u
    LEFT JOIN student s ON s.user_pk = u.pk
    LEFT JOIN student_profile sp ON sp.student_pk = s.pk
      AND sp.version = (SELECT max(version) FROM student_profile WHERE student_pk = s.pk)
    LEFT JOIN department d ON d.pk = sp.department_pk
    LEFT JOIN school sc ON sc.pk = d.school_pk
    LEFT JOIN graduated g ON g.user_pk = u.pk
    LEFT JOIN graduated_profile gp ON gp.graduated_pk = g.pk
    LEFT JOIN company_alias ca ON ca.pk = gp.company_alias_pk
    WHERE <filter>   -- keyword: u.pk::text ILIKE ?1 OR u.name ILIKE ?1 OR u.email ILIKE ?1
    ORDER BY u.created_at DESC, u.pk DESC LIMIT ?2 OFFSET ?3;

    SELECT count(*) FROM users u WHERE <filter>;
     */
  async findPage(
    filter: AdminUserFilter,
    offset: number,
    limit: number,
  ): Promise<AdminUserPage> {
    const where = toConditions(filter);
    const [rows, [{ total }]] = await Promise.all([
      this.dbService.db
        .select({
          pk: users.pk,
          name: users.name,
          email: users.email,
          type: users.type,
          status: users.status,
          isDeleted: users.isDeleted,
          withdrawRequestedAt: users.withdrawRequestedAt,
          createdAt: users.createdAt,
          lastActiveAt: users.lastActiveAt,
          school: school.name,
          department: department.name,
          company: companyAlias.name,
          job: graduatedProfile.job,
        })
        .from(users)
        .leftJoin(student, eq(student.userPk, users.pk))
        .leftJoin(studentProfile, isLatestStudentProfile)
        .leftJoin(department, eq(department.pk, studentProfile.departmentPk))
        .leftJoin(school, eq(school.pk, department.schoolPk))
        .leftJoin(graduated, eq(graduated.userPk, users.pk))
        .leftJoin(
          graduatedProfile,
          eq(graduatedProfile.graduatedPk, graduated.pk),
        )
        .leftJoin(companyAlias, isProfileCompany)
        .where(where)
        .orderBy(desc(users.createdAt), desc(users.pk))
        .limit(limit)
        .offset(offset),
      this.dbService.db.select({ total: count() }).from(users).where(where),
    ]);
    return { rows, total };
  }

  /*
    SELECT pk, name, email, type, status, is_deleted, withdraw_requested_at, created_at, updated_at, last_active_at
    FROM users WHERE pk = ?1;
     */
  async findByPk(pk: string): Promise<AdminUserRow | null> {
    const [row] = await this.dbService.db
      .select({
        pk: users.pk,
        name: users.name,
        email: users.email,
        type: users.type,
        status: users.status,
        isDeleted: users.isDeleted,
        withdrawRequestedAt: users.withdrawRequestedAt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        lastActiveAt: users.lastActiveAt,
      })
      .from(users)
      .where(eq(users.pk, pk))
      .limit(1);
    return row ?? null;
  }

  /*
    SELECT provider, email, created_at, last_login_at FROM user_oauth_account
    WHERE user_pk = ?1 ORDER BY created_at, provider;
     */
  async findOauthAccounts(userPk: string): Promise<AdminUserOauthAccountRow[]> {
    return this.dbService.db
      .select({
        provider: userOauthAccount.provider,
        email: userOauthAccount.email,
        createdAt: userOauthAccount.createdAt,
        lastLoginAt: userOauthAccount.lastLoginAt,
      })
      .from(userOauthAccount)
      .where(eq(userOauthAccount.userPk, userPk))
      .orderBy(userOauthAccount.createdAt, userOauthAccount.provider);
  }

  /*
    SELECT kakao_enabled, email_enabled FROM coffee_chat_contact WHERE user_pk = ?1;
     */
  async findContactFlags(
    userPk: string,
  ): Promise<AdminUserContactFlagsRow | null> {
    const [row] = await this.dbService.db
      .select({
        kakaoEnabled: coffeeChatContact.kakaoEnabled,
        emailEnabled: coffeeChatContact.emailEnabled,
      })
      .from(coffeeChatContact)
      .where(eq(coffeeChatContact.userPk, userPk))
      .limit(1);
    return row ?? null;
  }

  /*
    SELECT c.kakao_enabled, c.email_enabled, c.phone, c.email
    FROM coffee_chat_contact c JOIN users u ON u.pk = c.user_pk
    WHERE c.user_pk = ?1 AND u.is_deleted = false;
     */
  // 연락처 값(phone · email)을 읽는 유일한 곳. 부르는 쪽이 열람 기록을 남겨야 함
  async findContactByUserPk(
    userPk: string,
  ): Promise<AdminUserContactRow | null> {
    const [row] = await this.dbService.db
      .select({
        kakaoEnabled: coffeeChatContact.kakaoEnabled,
        emailEnabled: coffeeChatContact.emailEnabled,
        phone: coffeeChatContact.phone,
        email: coffeeChatContact.email,
      })
      .from(coffeeChatContact)
      .innerJoin(users, eq(users.pk, coffeeChatContact.userPk))
      .where(
        and(eq(coffeeChatContact.userPk, userPk), eq(users.isDeleted, false)),
      )
      .limit(1);
    return row ?? null;
  }

  /*
    SELECT consent_type, consent_version, agreed_at, revoked_at FROM user_consent
    WHERE user_pk = ?1 ORDER BY agreed_at DESC, pk DESC;
     */
  async findConsents(userPk: string): Promise<AdminUserConsentRow[]> {
    return this.dbService.db
      .select({
        consentType: userConsent.consentType,
        consentVersion: userConsent.consentVersion,
        agreedAt: userConsent.agreedAt,
        revokedAt: userConsent.revokedAt,
      })
      .from(userConsent)
      .where(eq(userConsent.userPk, userPk))
      .orderBy(desc(userConsent.agreedAt), desc(userConsent.pk));
  }

  /*
    SELECT s.pk, s.email, s.verified_at, sc.name, d.name, sp.interests, sp.activities,
      (SELECT count(*) FROM coffee_chat_request WHERE student_pk = s.pk)
    FROM student s
    LEFT JOIN student_profile sp ON sp.student_pk = s.pk
      AND sp.version = (SELECT max(version) FROM student_profile WHERE student_pk = s.pk)
    LEFT JOIN department d ON d.pk = sp.department_pk
    LEFT JOIN school sc ON sc.pk = d.school_pk
    WHERE s.user_pk = ?1;
     */
  async findStudentByUserPk(
    userPk: string,
  ): Promise<AdminUserStudentRow | null> {
    const [row] = await this.dbService.db
      .select({
        studentPk: student.pk,
        schoolEmail: student.email,
        verifiedAt: student.verifiedAt,
        school: school.name,
        department: department.name,
        interests: studentProfile.interests,
        activities: studentProfile.activities,
        requestCount: sql<number>`(SELECT count(*)::int FROM coffee_chat_request r WHERE r.student_pk = ${student.pk})`,
      })
      .from(student)
      .leftJoin(studentProfile, isLatestStudentProfile)
      .leftJoin(department, eq(department.pk, studentProfile.departmentPk))
      .leftJoin(school, eq(school.pk, department.schoolPk))
      .where(eq(student.userPk, userPk))
      .limit(1);
    return row ?? null;
  }

  /*
    SELECT g.pk, g.verified_at, g.business_card_key IS NOT NULL, gp.nickname, ca.name, gp.department, gp.job,
      gp.hashtags, gp.links, (SELECT count(*) FROM coffee_chat_request WHERE graduated_pk = g.pk)
    FROM graduated g
    LEFT JOIN graduated_profile gp ON gp.graduated_pk = g.pk
    LEFT JOIN company_alias ca ON ca.pk = gp.company_alias_pk
    WHERE g.user_pk = ?1;
     */
  async findGraduatedByUserPk(
    userPk: string,
  ): Promise<AdminUserGraduatedRow | null> {
    const [row] = await this.dbService.db
      .select({
        graduatedPk: graduated.pk,
        verifiedAt: graduated.verifiedAt,
        hasBusinessCard: sql<boolean>`${graduated.businessCardKey} IS NOT NULL`,
        nickname: graduatedProfile.nickname,
        company: companyAlias.name,
        department: graduatedProfile.department,
        job: graduatedProfile.job,
        hashtags: graduatedProfile.hashtags,
        links: graduatedProfile.links,
        requestCount: sql<number>`(SELECT count(*)::int FROM coffee_chat_request r WHERE r.graduated_pk = ${graduated.pk})`,
      })
      .from(graduated)
      .leftJoin(
        graduatedProfile,
        eq(graduatedProfile.graduatedPk, graduated.pk),
      )
      .leftJoin(companyAlias, isProfileCompany)
      .where(eq(graduated.userPk, userPk))
      .limit(1);
    return row ?? null;
  }
}
