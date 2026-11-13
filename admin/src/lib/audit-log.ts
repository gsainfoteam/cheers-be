export const AUDIT_LOG_PATH = "/api/manager/v1/audit-log";
export const ACCESS_LOG_PATH = "/api/manager/v1/access-log";

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "admin_auth.login": "어드민 로그인",
  "admin_account.create": "어드민 계정 등록",
  "admin_account.role_update": "어드민 권한 변경",
  "admin_account.delete": "어드민 계정 삭제",
  "interest.create": "관심분야 등록",
  "interest.rename": "관심분야 이름 변경",
  "interest.delete": "관심분야 삭제",
  "interest.reorder": "관심분야 순서 변경",
  "school_department.create": "학과 등록",
  "school_department.update": "학과 수정",
  "school_email_domain.replace": "학교 이메일 도메인 교체",
  "company.create": "회사 등록",
  "company.update": "회사 수정",
  "company.delete": "회사 삭제",
  "company.merge": "회사 병합",
  "company.logo_update": "회사 로고 변경",
  "company.import": "회사 일괄 가져오기",
  "company_name.add": "회사 이름 추가",
  "company_name.remove": "회사 이름 삭제",
  "consent.create": "이용약관 등록",
  "business_card.verification_cancel": "명함 인증 취소",
  "notification_log.delivery_lookup": "알림톡 결과 조회",
  "dev_user.hard_delete": "회원 완전탈퇴 (개발용)",
};

export const AUDIT_TARGET_TYPE_LABELS: Record<string, string> = {
  admin_account: "어드민 계정",
  interest: "관심분야",
  school_department: "학과",
  school_email_domain: "학교 이메일 도메인",
  company: "회사",
  company_name: "회사 이름",
  consent: "이용약관",
  business_card: "현업자 명함",
  notification_log: "알림 발송 결과",
  user: "회원",
};

export const ACCESS_TARGET_TYPE_LABELS: Record<string, string> = {
  business_card: "명함 이미지 열람",
  dev_user_hard_delete: "회원 완전탈퇴 (개발용)",
};

export type AuditSnapshot = Record<string, unknown>;

export type AuditLogItem = {
  pk: string;
  admin_email: string;
  action: string;
  target_type: string;
  target_id: string | null;
  before: AuditSnapshot | null;
  after: AuditSnapshot | null;
  created_at: string;
};

export type AccessLogItem = {
  pk: string;
  admin_email: string;
  target_type: string;
  target_id: string;
  created_at: string;
};

export type DiffRow = {
  key: string;
  before: string;
  after: string;
  changed: boolean;
};

const show = (value: unknown): string =>
  value === undefined ? "" : JSON.stringify(value, null, 2);

// before와 after의 키를 합쳐 한 줄씩 비교. 값이 같으면 changed=false
export function diffSnapshots(
  before: AuditSnapshot | null,
  after: AuditSnapshot | null,
): DiffRow[] {
  const keys = [
    ...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
  ];
  return keys.map((key) => {
    const b = show(before?.[key]);
    const a = show(after?.[key]);
    return { key, before: b, after: a, changed: b !== a };
  });
}
