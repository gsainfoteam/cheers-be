import { jsonb, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

// 감사 로그에 남기는 동작. "<target_type>.<verb>". 새 변경 API를 만들면 여기에도 추가
// (test/manager-audit-coverage.e2e-spec.ts가 모든 변경 라우트가 표에 있는지 검사함)
export const ADMIN_AUDIT_ACTIONS = [
  "admin_auth.login",
  "admin_account.create",
  "admin_account.role_update",
  "admin_account.delete",
  "interest.create",
  "interest.rename",
  "interest.delete",
  "interest.reorder",
  "school_department.create",
  "school_department.update",
  "school_email_domain.replace",
  "company.create",
  "company.update",
  "company.delete",
  "company.merge",
  "company.logo_update",
  "company.import",
  "company_name.add",
  "company_name.remove",
  "consent.create",
  "business_card.verification_cancel",
  "notification_log.delivery_lookup",
  "dev_user.hard_delete",
] as const;
export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

// 변경된 엔티티 종류
export const ADMIN_AUDIT_TARGET_TYPES = [
  "admin_account",
  "interest",
  "school_department",
  "school_email_domain",
  "company",
  "company_name",
  "consent",
  "business_card",
  "notification_log",
  "user",
] as const;
export type AdminAuditTargetType = (typeof ADMIN_AUDIT_TARGET_TYPES)[number];

// 변경 전 · 후 값. 엔티티의 컬럼만 담은 JSON (개인정보 · 파일 내용은 넣지 않음)
export type AdminAuditSnapshot = Record<string, unknown>;

/*
CREATE TABLE "admin_audit_log" (
    "pk"          uuid                     NOT NULL,
    "admin_email" varchar(64)              NOT NULL,
    "action"      varchar(64)              NOT NULL,
    "target_type" varchar(32)              NOT NULL,
    "target_id"   varchar(64),
    "before"      jsonb,
    "after"       jsonb,
    "created_at"  timestamp with time zone NOT NULL DEFAULT NOW()
);
*/
// 어드민의 데이터 변경 기록 (CRB-81). 변경과 같은 트랜잭션에서 insert만 함 (수정 · 삭제 없음).
// 대상 엔티티가 지워져도 남도록 어떤 테이블로도 FK를 걸지 않고, 어드민 계정을 지워도 남도록 admin_account에도 걸지 않음
export const adminAuditLog = pgTable("admin_audit_log", {
  pk: uuid("pk").primaryKey().notNull(),
  // 요청 시점의 어드민 이메일
  adminEmail: varchar("admin_email", { length: 64 }).notNull(),
  // ADMIN_AUDIT_ACTIONS 중 하나. enum이 아니라 문자열이라 동작을 추가해도 마이그레이션이 필요 없음
  action: varchar("action", { length: 64 }).$type<AdminAuditAction>().notNull(),
  targetType: varchar("target_type", { length: 32 })
    .$type<AdminAuditTargetType>()
    .notNull(),
  // 대상 엔티티의 pk (문자열). 대상이 하나로 정해지지 않는 일괄 작업은 null
  targetId: varchar("target_id", { length: 64 }),
  // 생성이면 null
  before: jsonb("before").$type<AdminAuditSnapshot>(),
  // 삭제면 null
  after: jsonb("after").$type<AdminAuditSnapshot>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
