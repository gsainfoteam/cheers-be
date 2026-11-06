// 개발용 가짜 데이터 (로컬 · staging). production 이미지에는 들어가지 않음 (Dockerfile INCLUDE_DEV_SEED)
// staging pod에는 tsconfig가 없어 alias 없이 상대 경로로만 import함
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { and, asc, between, eq, inArray, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { adminAccessLog } from "./schema/admin-access-log";
import { coffeeChatContact } from "./schema/coffee-chat-contact";
import { coffeeChatRequest } from "./schema/coffee-chat-request";
import { companyAlias } from "./schema/company-alias";
import { companyName } from "./schema/company-name";
import { consent } from "./schema/consent";
import { department } from "./schema/department";
import { graduated } from "./schema/graduated";
import { graduatedProfile } from "./schema/graduated-profile";
import { interest } from "./schema/interest";
import { notificationLog } from "./schema/notification-log";
import { refreshToken } from "./schema/refresh-token";
import { schoolEmailDomain } from "./schema/school-email-domain";
import { student } from "./schema/student";
import { studentEmailSendLog } from "./schema/student-email-send-log";
import { studentEmailVerification } from "./schema/student-email-verification";
import { studentProfile } from "./schema/student-profile";
import { studentProfileAttachment } from "./schema/student-profile-attachment";
import { userConsent } from "./schema/user-consent";
import { userOauthAccount } from "./schema/user-oauth-account";
import { users } from "./schema/users";

type Db = NodePgDatabase<Record<string, unknown>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// 개발용 행의 pk 범위. 탈퇴 처리된 유저는 email이 null이라 이메일로는 구분할 수 없음
const DEV_PK_PREFIX = "de000000-0000-4000-8000-";
const DEV_PK_MIN = `${DEV_PK_PREFIX}000000000000`;
const DEV_PK_MAX = `${DEV_PK_PREFIX}ffffffffffff`;

const DEV_EMAIL_DOMAIN = "dev.cheers.local";

// 고아 파일 정리(business-card/, attachment/)가 보지 않는 위치. 로컬 seed가 staging 버킷에 올려도 고아로 잡히지 않음
const DEV_BUSINESS_CARD_PREFIX = "dev-seed/business-card";
const DEV_BUSINESS_CARD_ASSETS = [1, 2, 3, 4].map((n) =>
  join(__dirname, "seed-dev-assets", `business-card-${n}.png`),
);
const UPLOAD_CONCURRENCY = 5;

const ACTIVE_STUDENT_COUNT = 25;
const VERIFIED_GRADUATED_COUNT = 25;
const CANCELLED_GRADUATED_COUNT = 3;
const REQUEST_COUNT = 60;
// 탈퇴 유예기간 안에 들어가도록 며칠 전으로 둠
const WITHDRAW_REQUESTED_DAYS_AGO = 3;

const SURNAMES = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임"];
const GIVEN_NAMES = [
  "서연",
  "민준",
  "지우",
  "하준",
  "수아",
  "도윤",
  "예린",
  "시우",
  "유나",
  "주원",
  "채원",
  "건우",
];
const COMPANIES = [
  "가상전자",
  "예시소프트",
  "테스트바이오",
  "더미파이낸스",
  "샘플모빌리티",
];
// 회사마다 함께 등록할 다른 표기 (어드민 검색 · 병합 확인용). 이름이 없는 회사는 회사 이름 표기만
const COMPANY_OTHER_NAMES: Record<string, string[]> = {
  가상전자: ["Gasang Electronics", "가상"],
  예시소프트: ["Example Soft", "(주)예시소프트"],
};
// 현업자가 직접 입력해 생긴 회사처럼 어드민 검토 대기열에 둘 회사
const COMPANIES_NEEDING_REVIEW = new Set(["샘플모빌리티"]);
const COMPANY_DEPARTMENTS = ["연구개발본부", "플랫폼개발팀", "전략기획팀"];
const JOBS = [
  "백엔드 개발자",
  "반도체 엔지니어",
  "연구원",
  "데이터 사이언티스트",
];
const HASHTAGS = ["#커리어", "#대학원", "#이직", "#창업", "#취업준비"];
const ACTIVITIES = ["학부 연구생", "창업 동아리", "교환학생", "공모전 수상"];
const MESSAGES = [
  "직무를 준비하려면 어떤 경험이 도움이 되는지 궁금합니다.",
  "입사 후 첫해에 어떤 일을 하셨는지 듣고 싶습니다.",
  "대학원 진학과 취업 중에 어떻게 결정하셨나요?",
  null,
];

// 커피챗 진행 단계. toRequestStatus(src/cheers/cheers.utils.ts)가 시각 컬럼으로 계산함
const REQUEST_STAGES = [
  "requested",
  "viewed",
  "contact_shared",
  "student_viewed",
] as const;
type RequestStage = (typeof REQUEST_STAGES)[number];

const PK_KIND = {
  user: 1,
  student: 2,
  studentProfile: 3,
  attachment: 4,
  graduated: 5,
  request: 6,
  notificationLog: 7,
  userConsent: 8,
  sendLog: 9,
} as const;

type ReferenceData = {
  emailDomain: string;
  departmentPks: number[];
  interests: string[];
  consents: { type: string; version: string }[];
  // COMPANIES 이름 → company_alias.pk
  companyPks: Map<string, number>;
};

type ContactRow = typeof coffeeChatContact.$inferInsert;

type SeedStudent = {
  pk: string;
  firstProfilePk: string;
  latestProfilePk: string;
  contact: ContactRow | null;
};

type SeedGraduated = {
  pk: string;
  // 요청 시점에 공유한 연락처. 탈퇴 처리되면 연락 설정 행은 지워져도 요청에는 남아 있음
  contact: ContactRow;
};

export type DevSeedResult = {
  users: number;
  coffeeChatRequests: number;
  businessCardKeys: string[];
};

export type DevUploadResult = {
  uploaded: number;
  // 실패 원인. null이면 전부 성공
  error: string | null;
};

const devPk = (kind: number, seq: number): string =>
  `${DEV_PK_PREFIX}${kind.toString(16).padStart(2, "0")}${seq
    .toString(16)
    .padStart(10, "0")}`;

const pad = (n: number): string => String(n).padStart(2, "0");

const pick = <T>(list: readonly T[], index: number): T =>
  list[index % list.length];

const devName = (index: number): string =>
  `[dev] ${pick(SURNAMES, index)}${pick(GIVEN_NAMES, index)}`;

// 기준 데이터는 환경마다 다를 수 있어(어드민에서 수정) DB에서 읽음
async function loadReferenceData(tx: Tx): Promise<ReferenceData> {
  const [domain] = await tx
    .select({
      schoolPk: schoolEmailDomain.schoolPk,
      domain: schoolEmailDomain.domain,
    })
    .from(schoolEmailDomain)
    .orderBy(asc(schoolEmailDomain.pk))
    .limit(1);
  const departments = domain
    ? await tx
        .select({ pk: department.pk })
        .from(department)
        .where(
          and(
            eq(department.schoolPk, domain.schoolPk),
            eq(department.isActive, true),
          ),
        )
        .orderBy(asc(department.pk))
    : [];
  const interests = await tx
    .select({ name: interest.name })
    .from(interest)
    .orderBy(asc(interest.sortOrder));
  const consents = await tx
    .select({ type: consent.type, version: consent.version })
    .from(consent);

  if (
    !domain ||
    departments.length === 0 ||
    interests.length === 0 ||
    consents.length === 0
  ) {
    throw new Error(
      "Reference data is missing. Run `bun run db:migrate` first.",
    );
  }

  return {
    emailDomain: domain.domain,
    companyPks: await ensureDevCompanies(tx),
    departmentPks: departments.map((d) => d.pk),
    interests: interests.map((i) => i.name),
    consents,
  };
}

// FK가 NO ACTION이라 자식부터 지움. API로 생긴 행(새 프로필 버전, 새 요청)도 지우도록 pk가 아니라 소유 관계로 찾음.
// 실제 유저가 개발용 현업자에게 보낸 요청은 FK 때문에 같이 지워짐
export async function deleteDevData(tx: Tx): Promise<void> {
  const devUserPks = tx
    .select({ pk: users.pk })
    .from(users)
    .where(between(users.pk, DEV_PK_MIN, DEV_PK_MAX));
  const devStudentPks = tx
    .select({ pk: student.pk })
    .from(student)
    .where(inArray(student.userPk, devUserPks));
  const devGraduatedPks = tx
    .select({ pk: graduated.pk })
    .from(graduated)
    .where(inArray(graduated.userPk, devUserPks));
  const devRequestPks = tx
    .select({ pk: coffeeChatRequest.pk })
    .from(coffeeChatRequest)
    .where(
      or(
        inArray(coffeeChatRequest.studentPk, devStudentPks),
        inArray(coffeeChatRequest.graduatedPk, devGraduatedPks),
      ),
    );
  const devProfilePks = tx
    .select({ pk: studentProfile.pk })
    .from(studentProfile)
    .where(inArray(studentProfile.studentPk, devStudentPks));

  await tx
    .delete(notificationLog)
    .where(inArray(notificationLog.coffeeChatRequestPk, devRequestPks));
  await tx
    .delete(coffeeChatRequest)
    .where(
      or(
        inArray(coffeeChatRequest.studentPk, devStudentPks),
        inArray(coffeeChatRequest.graduatedPk, devGraduatedPks),
      ),
    );
  await tx
    .delete(studentProfileAttachment)
    .where(inArray(studentProfileAttachment.profilePk, devProfilePks));
  await tx
    .delete(studentProfile)
    .where(inArray(studentProfile.studentPk, devStudentPks));
  await tx
    .delete(studentEmailVerification)
    .where(inArray(studentEmailVerification.studentPk, devStudentPks));
  await tx.delete(student).where(inArray(student.userPk, devUserPks));

  // admin_access_log는 FK가 없고 target_id가 문자열이라 pk를 먼저 읽음
  const graduatedRows = await devGraduatedPks;
  await tx.delete(adminAccessLog).where(
    and(
      eq(adminAccessLog.targetType, "business_card"),
      inArray(
        adminAccessLog.targetId,
        graduatedRows.map((g) => g.pk),
      ),
    ),
  );
  await tx
    .delete(graduatedProfile)
    .where(inArray(graduatedProfile.graduatedPk, devGraduatedPks));
  await tx.delete(graduated).where(inArray(graduated.userPk, devUserPks));

  await tx
    .delete(userOauthAccount)
    .where(inArray(userOauthAccount.userPk, devUserPks));
  await tx.delete(refreshToken).where(inArray(refreshToken.userPk, devUserPks));
  await tx.delete(userConsent).where(inArray(userConsent.userPk, devUserPks));
  await tx
    .delete(coffeeChatContact)
    .where(inArray(coffeeChatContact.userPk, devUserPks));
  await tx
    .delete(studentEmailSendLog)
    .where(inArray(studentEmailSendLog.userPk, devUserPks));
  await tx.delete(users).where(between(users.pk, DEV_PK_MIN, DEV_PK_MAX));
}

// 같은 입력이면 같은 pk · 같은 값. 시각만 실행 시점 기준 (pending 정리, 탈퇴 유예기간에 걸리지 않게)
function buildDevRows(ref: ReferenceData, now: Date) {
  const rows = {
    users: [] as (typeof users.$inferInsert)[],
    oauthAccounts: [] as (typeof userOauthAccount.$inferInsert)[],
    userConsents: [] as (typeof userConsent.$inferInsert)[],
    contacts: [] as ContactRow[],
    students: [] as (typeof student.$inferInsert)[],
    studentProfiles: [] as (typeof studentProfile.$inferInsert)[],
    attachments: [] as (typeof studentProfileAttachment.$inferInsert)[],
    verifications: [] as (typeof studentEmailVerification.$inferInsert)[],
    sendLogs: [] as (typeof studentEmailSendLog.$inferInsert)[],
    graduates: [] as (typeof graduated.$inferInsert)[],
    graduatedProfiles: [] as (typeof graduatedProfile.$inferInsert)[],
    requests: [] as (typeof coffeeChatRequest.$inferInsert)[],
    notificationLogs: [] as (typeof notificationLog.$inferInsert)[],
  };
  const businessCardKeys: string[] = [];

  const sequences = new Map<number, number>();
  const nextPk = (kind: number): string => {
    const seq = (sequences.get(kind) ?? 0) + 1;
    sequences.set(kind, seq);
    return devPk(kind, seq);
  };
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const after = (from: Date, hours: number) =>
    new Date(from.getTime() + hours * HOUR_MS);

  const addUser = (input: {
    label: string;
    type: "student" | "graduated";
    status: "pending" | "active";
    name: string | null;
    createdAt: Date;
    withdrawRequestedAt?: Date;
    isDeleted?: boolean;
  }): string => {
    const pk = nextPk(PK_KIND.user);
    rows.users.push({
      pk,
      type: input.type,
      status: input.status,
      // 탈퇴 처리 후에는 이름 · 이메일을 지움 (UserRepository.withdraw)
      name: input.isDeleted ? null : input.name,
      email: input.isDeleted ? null : `${input.label}@${DEV_EMAIL_DOMAIN}`,
      isDeleted: input.isDeleted ?? false,
      withdrawRequestedAt: input.withdrawRequestedAt,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      lastActiveAt: input.createdAt,
    });
    if (!input.isDeleted) {
      rows.oauthAccounts.push({
        provider: "google",
        providerSub: input.label,
        userPk: pk,
        email: `${input.label}@${DEV_EMAIL_DOMAIN}`,
        lastLoginAt: input.createdAt,
      });
    }
    return pk;
  };

  // 어떤 버전이 최신이어도 약관 단계를 통과하도록 모든 행에 동의
  const agreeToConsents = (userPk: string, agreedAt: Date) => {
    for (const { type, version } of ref.consents) {
      rows.userConsents.push({
        pk: nextPk(PK_KIND.userConsent),
        userPk,
        consentType: type,
        consentVersion: version,
        agreedAt,
      });
    }
  };

  // 0: 카톡만, 1: 메일만, 2: 둘 다, 3: 희망하지 않음
  const addContact = (
    userPk: string,
    label: string,
    mode: number,
  ): ContactRow => {
    const kakaoEnabled = mode % 4 === 0 || mode % 4 === 2;
    const emailEnabled = mode % 4 === 1 || mode % 4 === 2;
    const contact: ContactRow = {
      userPk,
      kakaoEnabled,
      emailEnabled,
      // 미할당 대역이라 실제 번호와 겹치지 않음
      phone: kakaoEnabled ? `0100000${userPk.slice(-4)}` : null,
      email: emailEnabled ? `${label}@${DEV_EMAIL_DOMAIN}` : null,
    };
    rows.contacts.push(contact);
    return contact;
  };

  const addStudentProfile = (
    studentPk: string,
    version: number,
    index: number,
    createdAt: Date,
  ): string => {
    const pk = nextPk(PK_KIND.studentProfile);
    rows.studentProfiles.push({
      pk,
      studentPk,
      version,
      departmentPk: pick(ref.departmentPks, index + version - 1),
      interests: [0, 1, 2]
        .slice(0, (index % 3) + 1)
        .map((offset) => pick(ref.interests, index + offset)),
      activities: index % 2 === 0 ? [pick(ACTIVITIES, index)] : null,
      createdAt,
    });
    return pk;
  };

  const addAttachments = (profilePk: string, userPk: string, index: number) => {
    const add = (
      kind: "cv" | "portfolio",
      source: "file" | "link",
      url: string,
      fileName: string | null,
      sortOrder: number,
    ) =>
      rows.attachments.push({
        pk: nextPk(PK_KIND.attachment),
        profilePk,
        kind,
        source,
        sortOrder,
        url,
        fileName,
      });

    // 첨부는 어드민에서 열람하지 않아 더미 key만 넣음. presigned GET은 404
    if (index % 3 === 0) {
      add(
        "cv",
        "file",
        `attachment/${userPk}/dummy-cv.pdf`,
        `이력서-${pad(index + 1)}.pdf`,
        0,
      );
    }
    if (index % 3 === 1) {
      add(
        "portfolio",
        "link",
        `https://example.com/portfolio/${pad(index + 1)}`,
        null,
        0,
      );
    }
    if (index % 6 === 0) {
      add(
        "portfolio",
        "file",
        `attachment/${userPk}/dummy-portfolio.pdf`,
        `포트폴리오-${pad(index + 1)}.pdf`,
        1,
      );
    }
  };

  // 가입을 마친 재학생 (탈퇴 유예 · 탈퇴 처리 포함)
  const addActiveStudent = (input: {
    label: string;
    index: number;
    createdAt: Date;
    withdrawRequestedAt?: Date;
    isDeleted?: boolean;
  }): SeedStudent => {
    const { label, index, createdAt, isDeleted } = input;
    const userPk = addUser({
      label,
      type: "student",
      status: "active",
      name: devName(index),
      createdAt,
      withdrawRequestedAt: input.withdrawRequestedAt,
      isDeleted,
    });
    agreeToConsents(userPk, createdAt);

    const pk = nextPk(PK_KIND.student);
    rows.students.push({
      pk,
      userPk,
      email: isDeleted ? null : `${label}@${ref.emailDomain}`,
      verifiedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    });

    const firstProfilePk = addStudentProfile(pk, 1, index, createdAt);
    // 일부는 수정 이력을 둠. 그 전에 보낸 요청은 v1을 가리킴
    const latestProfilePk =
      index % 5 === 0
        ? addStudentProfile(pk, 2, index, after(createdAt, 24))
        : firstProfilePk;
    if (!isDeleted) addAttachments(latestProfilePk, userPk, index);

    return {
      pk,
      firstProfilePk,
      latestProfilePk,
      contact: isDeleted ? null : addContact(userPk, label, index),
    };
  };

  const addBusinessCard = (userPk: string): string => {
    const key = `${DEV_BUSINESS_CARD_PREFIX}/${userPk}.png`;
    businessCardKeys.push(key);
    return key;
  };

  // 가입을 마친 현업자 (인증 취소 · 탈퇴 유예 · 탈퇴 처리 포함)
  const addActiveGraduated = (input: {
    label: string;
    index: number;
    createdAt: Date;
    verified: boolean;
    withdrawRequestedAt?: Date;
    isDeleted?: boolean;
  }): SeedGraduated => {
    const { label, index, createdAt, verified, isDeleted } = input;
    const userPk = addUser({
      label,
      type: "graduated",
      status: "active",
      name: devName(index + 3),
      createdAt,
      withdrawRequestedAt: input.withdrawRequestedAt,
      isDeleted,
    });
    agreeToConsents(userPk, createdAt);

    const pk = nextPk(PK_KIND.graduated);
    rows.graduates.push({
      pk,
      userPk,
      // 인증 취소와 탈퇴 처리는 명함 key를 지움. key와 verified_at은 인증 취소 때 같이 비워짐
      businessCardKey: verified && !isDeleted ? addBusinessCard(userPk) : null,
      verifiedAt: verified ? createdAt : null,
      createdAt,
      updatedAt: createdAt,
    });
    rows.graduatedProfiles.push({
      graduatedPk: pk,
      nickname: `[dev] 현업자${pad(index + 1)}`,
      companyAliasPk: ref.companyPks.get(pick(COMPANIES, index)),
      department: pick(COMPANY_DEPARTMENTS, index),
      job: pick(JOBS, index),
      hashtags:
        index % 2 === 0
          ? [pick(HASHTAGS, index), pick(HASHTAGS, index + 1)]
          : null,
      links: index % 3 === 0 ? [`https://example.com/in/${label}`] : null,
      createdAt,
      updatedAt: createdAt,
    });

    if (isDeleted) {
      return {
        pk,
        contact: {
          userPk,
          kakaoEnabled: true,
          emailEnabled: true,
          phone: `0100000${userPk.slice(-4)}`,
          email: `${label}@${DEV_EMAIL_DOMAIN}`,
        },
      };
    }
    return { pk, contact: addContact(userPk, label, index) };
  };

  const addRequest = (input: {
    student: SeedStudent;
    studentProfilePk: string;
    graduated: SeedGraduated;
    stage: RequestStage;
    index: number;
    createdAt: Date;
  }) => {
    const { student: from, graduated: to, stage, index, createdAt } = input;
    const contactShared =
      stage === "contact_shared" || stage === "student_viewed";
    const pk = nextPk(PK_KIND.request);
    rows.requests.push({
      pk,
      graduatedPk: to.pk,
      studentPk: from.pk,
      studentProfilePk: input.studentProfilePk,
      message: pick(MESSAGES, index),
      createdAt,
      updatedAt: createdAt,
      graduatedViewedAt: stage === "requested" ? null : after(createdAt, 1),
      contactSharedAt: contactShared ? after(createdAt, 2) : null,
      studentViewedAt: stage === "student_viewed" ? after(createdAt, 3) : null,
      sharedPhone:
        contactShared && to.contact.kakaoEnabled ? to.contact.phone : null,
      sharedEmail:
        contactShared && to.contact.emailEnabled ? to.contact.email : null,
    });

    const addLogs = (
      event: "coffee_chat_requested" | "contact_shared",
      contact: ContactRow | null,
      at: Date,
    ) => {
      const channels = [
        { channel: "email" as const, recipient: contact?.email },
        { channel: "kakao_alimtalk" as const, recipient: contact?.phone },
      ];
      for (const { channel, recipient } of channels) {
        if (!recipient) continue;
        const seq = rows.notificationLogs.length + 1;
        const failed = seq % 7 === 0;
        rows.notificationLogs.push({
          pk: nextPk(PK_KIND.notificationLog),
          coffeeChatRequestPk: pk,
          event,
          channel,
          status: failed ? "failed" : "sent",
          providerMessageId: failed ? null : `dev-message-${seq}`,
          recipient,
          error: failed ? "dev seed: simulated failure" : null,
          createdAt: at,
        });
      }
    };
    addLogs("coffee_chat_requested", to.contact, createdAt);
    if (contactShared) {
      addLogs("contact_shared", from.contact, after(createdAt, 2));
    }
  };

  // 재학생 active
  const activeStudents = Array.from({ length: ACTIVE_STUDENT_COUNT }, (_, i) =>
    addActiveStudent({
      label: `dev-student-${pad(i + 1)}`,
      index: i,
      createdAt: ago(60 - i),
    }),
  );

  // 현업자 active + 인증 (= 이슈의 "승인")
  const verifiedGraduates = Array.from(
    { length: VERIFIED_GRADUATED_COUNT },
    (_, i) =>
      addActiveGraduated({
        label: `dev-graduated-${pad(i + 1)}`,
        index: i,
        createdAt: ago(90 - i),
        verified: true,
      }),
  );

  // 현업자 active + 인증 취소 (= 이슈의 "반려"). 다음 단계 verify
  for (let i = 0; i < CANCELLED_GRADUATED_COUNT; i++) {
    addActiveGraduated({
      label: `dev-graduated-cancelled-${pad(i + 1)}`,
      index: VERIFIED_GRADUATED_COUNT + i,
      createdAt: ago(45 - i),
      verified: false,
    });
  }

  // 가입 중. 정리 스케줄러(24시간)에 바로 걸리지 않게 최근 시각. 이름은 추가 정보 입력 때 받으므로 null
  const addPendingUser = (
    label: string,
    type: "student" | "graduated",
    agreed: boolean,
    withdrawRequestedAt?: Date,
  ): string => {
    const createdAt = new Date(now.getTime() - HOUR_MS);
    const userPk = addUser({
      label,
      type,
      status: "pending",
      name: null,
      createdAt,
      withdrawRequestedAt,
    });
    if (agreed) agreeToConsents(userPk, createdAt);
    return userPk;
  };
  const addPendingStudent = (
    label: string,
    agreed: boolean,
    verified: boolean,
    withdrawRequestedAt?: Date,
  ): string => {
    const userPk = addPendingUser(
      label,
      "student",
      agreed,
      withdrawRequestedAt,
    );
    const pk = nextPk(PK_KIND.student);
    rows.students.push({
      pk,
      userPk,
      email: verified ? `${label}@${ref.emailDomain}` : null,
      verifiedAt: verified ? now : null,
    });
    return pk;
  };
  const addPendingGraduated = (
    label: string,
    agreed: boolean,
    hasBusinessCard: boolean,
  ) => {
    const userPk = addPendingUser(label, "graduated", agreed);
    rows.graduates.push({
      pk: nextPk(PK_KIND.graduated),
      userPk,
      businessCardKey: hasBusinessCard ? addBusinessCard(userPk) : null,
      verifiedAt: hasBusinessCard ? now : null,
    });
  };

  addPendingStudent("dev-pending-student-consent", false, false);
  const verifyingLabel = "dev-pending-student-verify";
  const verifyingStudentPk = addPendingStudent(verifyingLabel, true, false);
  const verifyingEmail = `${verifyingLabel}@${ref.emailDomain}`;
  rows.verifications.push({
    studentPk: verifyingStudentPk,
    // 인증번호의 HMAC 자리. 이 값으로는 인증되지 않음
    code: "0".repeat(64),
    expiresAt: new Date(now.getTime() + DAY_MS),
    email: verifyingEmail,
  });
  rows.sendLogs.push({
    pk: nextPk(PK_KIND.sendLog),
    userPk: rows.users[rows.users.length - 1].pk,
    email: verifyingEmail,
  });
  addPendingStudent("dev-pending-student-profile", true, true);
  // 명함 업로드 전 (= 이슈의 "대기")
  addPendingGraduated("dev-pending-graduated-consent", false, false);
  addPendingGraduated("dev-pending-graduated-verify", true, false);
  addPendingGraduated("dev-pending-graduated-profile", true, true);

  // 탈퇴 유예 중
  const withdrawRequestedAt = ago(WITHDRAW_REQUESTED_DAYS_AGO);
  const withdrawingStudents = [0, 1].map((i) =>
    addActiveStudent({
      label: `dev-student-withdrawing-${pad(i + 1)}`,
      index: ACTIVE_STUDENT_COUNT + i,
      createdAt: ago(70 - i),
      withdrawRequestedAt,
    }),
  );
  const withdrawingGraduates = [0, 1].map((i) =>
    addActiveGraduated({
      label: `dev-graduated-withdrawing-${pad(i + 1)}`,
      index: VERIFIED_GRADUATED_COUNT + CANCELLED_GRADUATED_COUNT + i,
      createdAt: ago(80 - i),
      verified: true,
      withdrawRequestedAt,
    }),
  );
  addPendingStudent(
    "dev-pending-student-withdrawing",
    true,
    false,
    new Date(now.getTime() - 2 * HOUR_MS),
  );

  // 탈퇴 처리 완료 (개인정보를 지운 형태. 지난 요청은 남음)
  const purgedAt = ago(100);
  const purgedStudent = addActiveStudent({
    label: "dev-student-purged",
    index: ACTIVE_STUDENT_COUNT + 2,
    createdAt: ago(120),
    withdrawRequestedAt: purgedAt,
    isDeleted: true,
  });
  const purgedGraduated = addActiveGraduated({
    label: "dev-graduated-purged",
    index: VERIFIED_GRADUATED_COUNT + CANCELLED_GRADUATED_COUNT + 2,
    createdAt: ago(130),
    verified: true,
    withdrawRequestedAt: purgedAt,
    isDeleted: true,
  });

  // 커피챗 요청. 연락 설정을 꺼 둔 현업자에게는 요청할 수 없어 제외
  const requestable = verifiedGraduates.filter(
    ({ contact }) => contact.kakaoEnabled || contact.emailEnabled,
  );
  for (let i = 0; i < REQUEST_COUNT; i++) {
    const from = pick(activeStudents, i);
    addRequest({
      student: from,
      // 짝수 번째는 수정 전 버전으로 보낸 요청
      studentProfilePk:
        i % 2 === 0 ? from.firstProfilePk : from.latestProfilePk,
      graduated: pick(requestable, i * 7),
      stage: pick(REQUEST_STAGES, i),
      index: i,
      createdAt: ago(40 - i * 0.6),
    });
  }

  // 상대가 탈퇴 유예 · 탈퇴 처리 상태인 요청
  const counterpartRequests: {
    from: SeedStudent;
    to: SeedGraduated;
    stage: RequestStage;
  }[] = [
    { from: withdrawingStudents[0], to: requestable[0], stage: "requested" },
    { from: withdrawingStudents[1], to: requestable[1], stage: "viewed" },
    { from: purgedStudent, to: requestable[2], stage: "contact_shared" },
    {
      from: activeStudents[0],
      to: withdrawingGraduates[0],
      stage: "requested",
    },
    {
      from: activeStudents[1],
      to: withdrawingGraduates[1],
      stage: "student_viewed",
    },
    { from: activeStudents[2], to: purgedGraduated, stage: "contact_shared" },
  ];
  counterpartRequests.forEach(({ from, to, stage }, i) => {
    addRequest({
      student: from,
      studentProfilePk: from.latestProfilePk,
      graduated: to,
      stage,
      index: i,
      createdAt: ago(10 + i),
    });
  });

  return { rows, businessCardKeys };
}

// 개발용 회사. 회사는 다른(실제) 현업자도 고를 수 있어 지우지 않고, 없을 때만 만듦 (다시 실행해도 그대로)
// 정규화는 src/company/company.utils.ts normalizeCompanyName 과 같은 규칙 (staging pod에는 alias가 없어 import하지 않음)
async function ensureDevCompanies(tx: Tx): Promise<Map<string, number>> {
  const normalize = (name: string) =>
    name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
  const pks = new Map<string, number>();

  for (const name of COMPANIES) {
    const [existing] = await tx
      .select({ aliasPk: companyName.aliasPk })
      .from(companyName)
      .where(eq(companyName.normalizedName, normalize(name)));
    if (existing) {
      pks.set(name, existing.aliasPk);
      continue;
    }

    const [alias] = await tx
      .insert(companyAlias)
      .values({ name, needsReview: COMPANIES_NEEDING_REVIEW.has(name) })
      .returning();
    await tx
      .insert(companyName)
      .values(
        [name, ...(COMPANY_OTHER_NAMES[name] ?? [])].map((n) => ({
          aliasPk: alias.pk,
          name: n,
          normalizedName: normalize(n),
        })),
      )
      .onConflictDoNothing();
    pks.set(name, alias.pk);
  }
  return pks;
}

// 한 트랜잭션에서 지우고 다시 넣음. 중간에 실패하면 이전 데이터가 그대로 남음
export async function seedDevData(db: Db): Promise<DevSeedResult> {
  return db.transaction(async (tx) => {
    const ref = await loadReferenceData(tx);
    await deleteDevData(tx);

    const { rows, businessCardKeys } = buildDevRows(ref, new Date());
    await tx.insert(users).values(rows.users);
    await tx.insert(userOauthAccount).values(rows.oauthAccounts);
    await tx.insert(userConsent).values(rows.userConsents);
    await tx.insert(coffeeChatContact).values(rows.contacts);
    await tx.insert(student).values(rows.students);
    await tx.insert(studentProfile).values(rows.studentProfiles);
    await tx.insert(studentProfileAttachment).values(rows.attachments);
    await tx.insert(studentEmailVerification).values(rows.verifications);
    await tx.insert(studentEmailSendLog).values(rows.sendLogs);
    await tx.insert(graduated).values(rows.graduates);
    await tx.insert(graduatedProfile).values(rows.graduatedProfiles);
    await tx.insert(coffeeChatRequest).values(rows.requests);
    await tx.insert(notificationLog).values(rows.notificationLogs);

    return {
      users: rows.users.length,
      coffeeChatRequests: rows.requests.length,
      businessCardKeys,
    };
  });
}

// 어드민 명함 화면에서 볼 수 있도록 샘플 이미지를 올림. 같은 key를 덮어쓰므로 다시 실행해도 안전함.
// 자격증명이나 버킷 설정이 없어도 DB 데이터는 쓸 수 있으니 예외를 던지지 않고 결과로 돌려줌 (이미지만 404)
export async function uploadDevBusinessCards(
  keys: string[],
): Promise<DevUploadResult> {
  const region = process.env.AWS_S3_REGION;
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  if (!region || !bucket) {
    return {
      uploaded: 0,
      error: "AWS_S3_REGION or AWS_S3_BUCKET_NAME is not set",
    };
  }

  const client = new S3Client({
    region,
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  let uploaded = 0;
  try {
    const images = await Promise.all(
      DEV_BUSINESS_CARD_ASSETS.map((path) => readFile(path)),
    );
    for (let i = 0; i < keys.length; i += UPLOAD_CONCURRENCY) {
      await Promise.all(
        keys.slice(i, i + UPLOAD_CONCURRENCY).map(async (key, offset) => {
          await client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: pick(images, i + offset),
              ContentType: "image/png",
            }),
          );
          uploaded++;
        }),
      );
    }
    return { uploaded, error: null };
  } catch (error) {
    return { uploaded, error: (error as Error).message };
  } finally {
    client.destroy();
  }
}
