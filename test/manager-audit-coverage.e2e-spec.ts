import {
  ADMIN_AUDIT_ACTIONS,
  AdminAuditAction,
} from "@drizzle/schema/admin-audit-log";
import { createE2eApp, E2eContext } from "./support/app";
import { listManagerRoutes, MANAGER_PREFIX } from "./support/manager-routes";

// 데이터를 바꾸는 어드민 API(POST · PUT · PATCH · DELETE)가 감사 로그의 어떤 action으로 남는지.
// 변경 라우트를 추가하면 여기에 action을 적거나 남기지 않는 이유를 EXCLUDED에 적어야 아래 검사를 통과함 (CRB-81)
const AUDITED: Record<string, AdminAuditAction> = {
  "POST /auth/login": "admin_auth.login",

  "POST /admin-account": "admin_account.create",
  "PATCH /admin-account/:pk": "admin_account.role_update",
  "DELETE /admin-account/:pk": "admin_account.delete",

  "POST /interest": "interest.create",
  "PUT /interest/order": "interest.reorder",
  "PATCH /interest/:pk": "interest.rename",
  "DELETE /interest/:pk": "interest.delete",

  "POST /school/:schoolPk/department": "school_department.create",
  "PATCH /school/:schoolPk/department/:departmentPk":
    "school_department.update",
  "PUT /school/:schoolPk/email-domain": "school_email_domain.replace",

  "POST /consent": "consent.create",

  "POST /business-card/:graduatedPk/cancel-verification":
    "business_card.verification_cancel",
  "POST /coffee-chat/notification-log/:pk/delivery-lookup":
    "notification_log.delivery_lookup",

  "POST /company": "company.create",
  "PATCH /company/:pk": "company.update",
  "DELETE /company/:pk": "company.delete",
  "POST /company/:pk/merge": "company.merge",
  "PUT /company/:pk/logo": "company.logo_update",
  "POST /company/import": "company.import",
  "POST /company/:pk/name": "company_name.add",
  "DELETE /company/:pk/name/:namePk": "company_name.remove",

  "DELETE /dev/user/:userPk": "dev_user.hard_delete",
};

const EXCLUDED: Record<string, string> = {
  "POST /company/logo/upload-url": "presigned URL만 발급하고 저장하지 않음",
  "POST /company/import/preview": "미리보기는 트랜잭션을 되돌려 저장하지 않음",
};

describe("어드민 감사 로그 대상 라우트", () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it("데이터를 바꾸는 모든 어드민 라우트가 AUDITED 또는 EXCLUDED에 있음", () => {
    const mutating = listManagerRoutes(ctx.app)
      .filter((r) => r.method !== "GET")
      .map((r) => `${r.method} ${r.path.slice(MANAGER_PREFIX.length)}`);

    expect(mutating.sort()).toEqual(
      [...Object.keys(AUDITED), ...Object.keys(EXCLUDED)].sort(),
    );
  });

  it("정의된 모든 action이 라우트에 연결돼 있음 (쓰이지 않는 action 없음)", () => {
    expect([...new Set(Object.values(AUDITED))].sort()).toEqual(
      [...ADMIN_AUDIT_ACTIONS].sort(),
    );
  });
});
