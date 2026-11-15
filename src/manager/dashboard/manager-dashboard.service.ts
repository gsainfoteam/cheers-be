import { Injectable } from "@nestjs/common";
import {
  AdminDashboardMemberRow,
  AdminDashboardMonthlyRequest,
  AdminDashboardRepository,
} from "@src/admin-repository/admin-dashboard.repository";
import {
  DashboardMemberTypeDto,
  DashboardRange,
  DEFAULT_DASHBOARD_RANGE,
  ManagerDashboardCoffeeChatDto,
  ManagerDashboardDemandDto,
  ManagerDashboardMemberDto,
  ManagerDashboardTodoDto,
} from "@src/manager/dashboard/dto/manager-dashboard.dto";

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const RANGE_DAYS: Record<DashboardRange, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};
// 방치 요청 기준
const STALE_DAYS = 3;
const TOP_LIMIT = 5;
const MONTHLY_TREND_MONTHS = 6;
const NOTIFICATION_DAYS = 7;

// 분모가 0이면 0%가 아니라 null
const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

const daysAgo = (now: Date, days: number) =>
  new Date(now.getTime() - days * DAY_MS);

// Asia/Seoul 기준 최근 n개월의 "YYYY-MM" (오래된 순)
export const recentMonths = (now: Date, count: number): string[] => {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth();

  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(year, month - (count - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
};

// "YYYY-MM"의 Asia/Seoul 1일 0시 (UTC Date)
const monthStart = (month: string): Date => {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1, 1) - KST_OFFSET_MS);
};

const emptyMember = (): DashboardMemberTypeDto => ({
  active: 0,
  pending: 0,
  new: 0,
  active_7d: 0,
  active_30d: 0,
});

const toMemberDto = (
  rows: AdminDashboardMemberRow[],
  type: AdminDashboardMemberRow["type"],
): DashboardMemberTypeDto => {
  const row = rows.find((r) => r.type === type);
  if (!row) return emptyMember();

  return {
    active: row.active,
    pending: row.pending,
    new: row.newActive,
    active_7d: row.active7d,
    active_30d: row.active30d,
  };
};

const fillMonths = (
  months: string[],
  rows: AdminDashboardMonthlyRequest[],
): { month: string; count: number }[] => {
  const counts = new Map(rows.map((r) => [r.month, r.count]));
  return months.map((month) => ({ month, count: counts.get(month) ?? 0 }));
};

@Injectable()
export class ManagerDashboardService {
  constructor(private readonly dashboard: AdminDashboardRepository) {}

  async getCoffeeChat(
    range: DashboardRange = DEFAULT_DASHBOARD_RANGE,
  ): Promise<ManagerDashboardCoffeeChatDto> {
    const now = new Date();
    const months = recentMonths(now, MONTHLY_TREND_MONTHS);
    const [funnel, stale, monthly] = await Promise.all([
      this.dashboard.coffeeChatFunnel(daysAgo(now, RANGE_DAYS[range])),
      this.dashboard.staleRequests(daysAgo(now, STALE_DAYS)),
      this.dashboard.monthlyRequests(monthStart(months[0])),
    ]);

    return {
      range,
      generated_at: now.toISOString(),
      funnel: {
        requested: funnel.requested,
        graduated_viewed: funnel.graduatedViewed,
        accepted: funnel.accepted,
        contact_shared: funnel.contactShared,
        student_viewed: funnel.studentViewed,
        rates: {
          viewed: ratio(funnel.graduatedViewed, funnel.requested),
          accepted: ratio(funnel.accepted, funnel.graduatedViewed),
          contact_shared: ratio(funnel.contactShared, funnel.accepted),
        },
        avg_hours: {
          to_viewed: funnel.hoursToViewed,
          to_accepted: funnel.hoursToAccepted,
          to_shared: funnel.hoursToShared,
        },
        stale: {
          unviewed_3d: stale.unviewed,
          unaccepted_3d: stale.unaccepted,
        },
      },
      monthly_requests: fillMonths(months, monthly),
    };
  }

  async getMember(
    range: DashboardRange = DEFAULT_DASHBOARD_RANGE,
  ): Promise<ManagerDashboardMemberDto> {
    const now = new Date();
    const [rows, withdrawPending] = await Promise.all([
      this.dashboard.memberStats(
        daysAgo(now, RANGE_DAYS[range]),
        daysAgo(now, 7),
        daysAgo(now, 30),
      ),
      this.dashboard.countWithdrawPending(),
    ]);

    return {
      range,
      generated_at: now.toISOString(),
      student: toMemberDto(rows, "student"),
      graduated: toMemberDto(rows, "graduated"),
      withdraw_pending: withdrawPending,
    };
  }

  async getDemand(
    range: DashboardRange = DEFAULT_DASHBOARD_RANGE,
  ): Promise<ManagerDashboardDemandDto> {
    const now = new Date();
    const from = daysAgo(now, RANGE_DAYS[range]);
    const [departments, companies, interests, requesters] = await Promise.all([
      this.dashboard.topDepartments(from, TOP_LIMIT),
      this.dashboard.topCompanies(from, TOP_LIMIT),
      this.dashboard.topInterests(from, TOP_LIMIT),
      this.dashboard.requesterCounts(from),
    ]);

    return {
      range,
      generated_at: now.toISOString(),
      departments,
      companies,
      interests,
      graduated_requested_ratio: ratio(
        requesters.requestedGraduated,
        requesters.activeGraduated,
      ),
      student_requested_ratio: ratio(
        requesters.requestedStudent,
        requesters.activeStudent,
      ),
    };
  }

  async getTodo(): Promise<ManagerDashboardTodoDto> {
    const now = new Date();
    const [businessCardPending, companyNeedsReview, notification] =
      await Promise.all([
        this.dashboard.countBusinessCardPending(),
        this.dashboard.countCompanyNeedsReview(),
        this.dashboard.notificationCounts(daysAgo(now, NOTIFICATION_DAYS)),
      ]);

    return {
      generated_at: now.toISOString(),
      business_card_pending: businessCardPending,
      company_needs_review: companyNeedsReview,
      notification: {
        failed: notification.failed,
        retry_waiting: notification.retryWaiting,
        delivery_unknown: notification.deliveryUnknown,
      },
    };
  }
}
