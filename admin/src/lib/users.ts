export const USER_BASE_PATH = "/api/manager/v1/user";
export const BUSINESS_CARD_PATH = "/api/manager/v1/business-card";

export type UserType = "student" | "graduated";
export type UserStatus = "pending" | "active";
export type WithdrawalState = "none" | "requested" | "deleted";
export type OauthProvider = "google" | "apple" | "naver";

export const USER_TYPE_LABELS: Record<UserType, string> = {
  student: "재학생",
  graduated: "현업자",
};

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  pending: "가입 중",
  active: "가입 완료",
};

export const WITHDRAWAL_STATE_LABELS: Record<WithdrawalState, string> = {
  none: "정상",
  requested: "탈퇴 유예 중",
  deleted: "탈퇴 완료",
};

export const OAUTH_PROVIDER_LABELS: Record<OauthProvider, string> = {
  google: "구글",
  apple: "애플",
  naver: "네이버",
};

export type UserAffiliation = {
  school: string | null;
  department: string | null;
  company: string | null;
  job: string | null;
};

export type UserListItem = {
  pk: string;
  name: string | null;
  email: string | null;
  type: UserType;
  status: UserStatus;
  withdrawal_state: WithdrawalState;
  affiliation: UserAffiliation;
  created_at: string;
  last_active_at: string;
};

export type UserDetail = {
  pk: string;
  name: string | null;
  email: string | null;
  type: UserType;
  status: UserStatus;
  withdrawal_state: WithdrawalState;
  created_at: string;
  updated_at: string;
  last_active_at: string;
  withdraw_requested_at: string | null;
  oauth_accounts: {
    provider: OauthProvider;
    email: string | null;
    created_at: string;
    last_login_at: string | null;
  }[];
  contact_methods: { kakao_enabled: boolean; email_enabled: boolean } | null;
  consents: {
    type: string;
    version: string;
    agreed_at: string;
    revoked_at: string | null;
  }[];
  student: {
    student_pk: string;
    school_email: string | null;
    verified_at: string | null;
    school: string | null;
    department: string | null;
    interests: string[] | null;
    activities: string[] | null;
  } | null;
  graduated: {
    graduated_pk: string;
    verified_at: string | null;
    has_business_card: boolean;
    nickname: string | null;
    company: string | null;
    department: string | null;
    job: string | null;
    hashtags: string[] | null;
    links: string[] | null;
  } | null;
  coffee_chat_request_count: number;
};

// GET {USER_BASE_PATH}/:pk/contact 응답. 조회할 때마다 열람 기록이 남음
export type UserContact = {
  kakao_enabled: boolean;
  email_enabled: boolean;
  phone: string | null;
  email: string | null;
};

// 탈퇴 완료 회원은 이름이 지워져 있음
export function userDisplayName(user: {
  name: string | null;
  withdrawal_state: WithdrawalState;
}): string {
  if (user.name) return user.name;
  return user.withdrawal_state === "deleted" ? "탈퇴한 회원" : "(이름 없음)";
}

export function affiliationLabel(
  type: UserType,
  affiliation: UserAffiliation,
): string {
  const parts =
    type === "student"
      ? [affiliation.school, affiliation.department]
      : [affiliation.company, affiliation.job];
  const label = parts.filter(Boolean).join(" · ");
  return label || "-";
}
