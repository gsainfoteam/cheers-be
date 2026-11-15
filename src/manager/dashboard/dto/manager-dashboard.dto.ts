import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";

export const DASHBOARD_RANGES = ["7d", "30d", "90d"] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];
export const DEFAULT_DASHBOARD_RANGE: DashboardRange = "30d";

export class DashboardRangeQueryDto {
  /** 기간 지표의 집계 기간. 생략하면 30d */
  @ApiPropertyOptional({
    enum: DASHBOARD_RANGES,
    default: DEFAULT_DASHBOARD_RANGE,
  })
  @IsOptional()
  @IsIn(DASHBOARD_RANGES)
  range?: DashboardRange;
}

export class DashboardNameCountDto {
  name: string;
  count: number;
}

export class DashboardFunnelRatesDto {
  /** 현업자 확인 / 요청. 요청이 없으면 null */
  viewed: number | null;
  /** 수락 / 현업자 확인 */
  accepted: number | null;
  /** 연락처 공유 / 수락 */
  contact_shared: number | null;
}

export class DashboardFunnelAvgHoursDto {
  to_viewed: number | null;
  to_accepted: number | null;
  to_shared: number | null;
}

export class DashboardFunnelStaleDto {
  /** 3일이 넘도록 현업자가 확인하지 않은 요청 (기간과 무관, 현재 시점) */
  unviewed_3d: number;
  /** 확인한 지 3일이 넘도록 수락하지 않은 요청 */
  unaccepted_3d: number;
}

export class DashboardFunnelDto {
  requested: number;
  graduated_viewed: number;
  accepted: number;
  contact_shared: number;
  student_viewed: number;
  rates: DashboardFunnelRatesDto;
  avg_hours: DashboardFunnelAvgHoursDto;
  stale: DashboardFunnelStaleDto;
}

export class DashboardMonthlyRequestDto {
  /** Asia/Seoul 기준 YYYY-MM */
  month: string;
  count: number;
}

export class ManagerDashboardCoffeeChatDto {
  range: DashboardRange;
  generated_at: string;
  funnel: DashboardFunnelDto;
  /** 최근 6개월. 요청이 없는 달은 0 */
  monthly_requests: DashboardMonthlyRequestDto[];
}

export class DashboardMemberTypeDto {
  /** 가입을 마친 회원 */
  active: number;
  /** 가입 진행 중인 회원 */
  pending: number;
  /** range 안에 가입을 마친 회원 */
  new: number;
  active_7d: number;
  active_30d: number;
}

export class ManagerDashboardMemberDto {
  range: DashboardRange;
  generated_at: string;
  student: DashboardMemberTypeDto;
  graduated: DashboardMemberTypeDto;
  /** 탈퇴 요청 후 유예기간 중인 회원 */
  withdraw_pending: number;
}

export class ManagerDashboardDemandDto {
  range: DashboardRange;
  generated_at: string;
  departments: DashboardNameCountDto[];
  companies: DashboardNameCountDto[];
  interests: DashboardNameCountDto[];
  /** range 안에 요청을 한 번이라도 받은 현업자 / 활성 현업자. 활성 현업자가 없으면 null */
  graduated_requested_ratio: number | null;
  /** range 안에 요청을 한 번이라도 보낸 재학생 / 활성 재학생 */
  student_requested_ratio: number | null;
}

export class DashboardNotificationDto {
  /** 최근 7일, 재시도까지 끝난 최종 실패 */
  failed: number;
  /** 최근 7일, 재시도 대기 중 */
  retry_waiting: number;
  /** 최근 7일, 알림톡 결과를 받지 못함 */
  delivery_unknown: number;
}

export class ManagerDashboardTodoDto {
  generated_at: string;
  /** 명함을 올렸지만 아직 인증하지 않은 현업자 */
  business_card_pending: number;
  company_needs_review: number;
  notification: DashboardNotificationDto;
}
