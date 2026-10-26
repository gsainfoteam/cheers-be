import { and, eq, isNull, SQL, sql } from "drizzle-orm";
import { users } from "../../../drizzle/schema/users";

// 유저 쿼리 공용 조각
// 사용 중인 계정: 탈퇴하지 않았고(is_deleted = false) 탈퇴 유예기간 중도 아님(withdraw_requested_at IS NULL).
// 유예기간 중인 유저는 비활성이라 다른 회원에게 보이지 않고 커피챗 요청 · 알림 대상에서도 빠져야 함.
// 현업자 목록, 커피챗 상대 조회, 알림 대상 선택 등 다른 회원을 다루는 쿼리는 is_deleted만 보지 말고 이 조건을 쓸 것

// drizzle 쿼리 빌더용: .where(and(..., isActiveAccount))
export const isActiveAccount: SQL = and(
  eq(users.isDeleted, false),
  isNull(users.withdrawRequestedAt),
)!;

// 직접 쓰는 sql 템플릿용 (users 테이블 별칭을 받음): sql`... WHERE ${isActiveAccountAs("u")}`
export const isActiveAccountAs = (alias: string): SQL =>
  sql`(${sql.raw(alias)}.is_deleted = false AND ${sql.raw(alias)}.withdraw_requested_at IS NULL)`;
