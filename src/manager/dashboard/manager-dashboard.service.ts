import { Injectable } from "@nestjs/common";
import {
  AdminDashboardBucketCount,
  AdminDashboardMemberRow,
  AdminDashboardMonthlyRequest,
  AdminDashboardRepository,
} from "@src/admin-repository/admin-dashboard.repository";
import {
  DashboardMemberTypeDto,
  DashboardRange,
  DEFAULT_DASHBOARD_RANGE,
  ManagerDashboardCoffeeChatDto,
  ManagerDashboardCoffeeChatMessageDto,
  ManagerDashboardCoffeeChatTrendDto,
  ManagerDashboardDemandDto,
  ManagerDashboardMemberDto,
  ManagerDashboardSignupTrendDto,
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
const TREND_DAYS = 30;
const TREND_WEEKS = 12;
// 신청 메시지 글자 수 구간 (최대 200자)
const MESSAGE_BUCKETS = [
  { label: "0-50", min: 0, max: 50 },
  { label: "51-100", min: 51, max: 100 },
  { label: "101-150", min: 101, max: 150 },
  { label: "151-200", min: 151, max: 200 },
] as const;

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

const dateKey = (utcDate: Date): string =>
  `${utcDate.getUTCFullYear()}-${String(utcDate.getUTCMonth() + 1).padStart(2, "0")}-${String(utcDate.getUTCDate()).padStart(2, "0")}`;

// Asia/Seoul 기준 최근 n일의 "YYYY-MM-DD" (오래된 순, 오늘 포함)
export const recentDays = (now: Date, count: number): string[] => {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const today = Date.UTC(
    kst.getUTCFullYear(),
    kst.getUTCMonth(),
    kst.getUTCDate(),
  );

  return Array.from({ length: count }, (_, i) =>
    dateKey(new Date(today - (count - 1 - i) * DAY_MS)),
  );
};

// Asia/Seoul 기준 최근 n주의 월요일 "YYYY-MM-DD" (오래된 순, 이번 주 포함)
export const recentWeeks = (now: Date, count: number): string[] => {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const today = Date.UTC(
    kst.getUTCFullYear(),
    kst.getUTCMonth(),
    kst.getUTCDate(),
  );
  const thisMonday = today - ((kst.getUTCDay() + 6) % 7) * DAY_MS;

  return Array.from({ length: count }, (_, i) =>
    dateKey(new Date(thisMonday - (count - 1 - i) * 7 * DAY_MS)),
  );
};

// "YYYY-MM-DD"의 Asia/Seoul 0시 (UTC Date)
const dayStart = (key: string): Date => {
  const [year, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1, d) - KST_OFFSET_MS);
};

const countMap = (rows: AdminDashboardBucketCount[]) =>
  new Map(rows.map((r) => [r.key, r.count]));

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
        contact_shared: funnel.contactShared,
        student_viewed: funnel.studentViewed,
        rates: {
          viewed: ratio(funnel.graduatedViewed, funnel.requested),
          contact_shared: ratio(funnel.contactShared, funnel.graduatedViewed),
        },
        avg_hours: {
          to_viewed: funnel.hoursToViewed,
          to_shared: funnel.hoursToShared,
        },
        stale: {
          unviewed_3d: stale.unviewed,
          unshared_3d: stale.unshared,
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

  async getCoffeeChatTrend(): Promise<ManagerDashboardCoffeeChatTrendDto> {
    const now = new Date();
    const days = recentDays(now, TREND_DAYS);
    const weeks = recentWeeks(now, TREND_WEEKS);
    const dayFrom = dayStart(days[0]);
    const weekFrom = dayStart(weeks[0]);
    const [dayRequested, dayShared, weekRequested, weekShared] =
      await Promise.all([
        this.dashboard.requestedBuckets("day", dayFrom),
        this.dashboard.sharedBuckets("day", dayFrom),
        this.dashboard.requestedBuckets("week", weekFrom),
        this.dashboard.sharedBuckets("week", weekFrom),
      ]);

    const toPoints = (
      keys: string[],
      requestedRows: AdminDashboardBucketCount[],
      sharedRows: AdminDashboardBucketCount[],
    ) => {
      const requested = countMap(requestedRows);
      const shared = countMap(sharedRows);
      return keys.map((date) => {
        const r = requested.get(date) ?? 0;
        const c = shared.get(date) ?? 0;
        return {
          date,
          requested: r,
          contact_shared: c,
          share_rate: ratio(c, r),
        };
      });
    };

    return {
      generated_at: now.toISOString(),
      daily: toPoints(days, dayRequested, dayShared),
      weekly: toPoints(weeks, weekRequested, weekShared),
    };
  }

  async getCoffeeChatMessage(
    range: DashboardRange = DEFAULT_DASHBOARD_RANGE,
  ): Promise<ManagerDashboardCoffeeChatMessageDto> {
    const now = new Date();
    const stats = await this.dashboard.messageLength(
      daysAgo(now, RANGE_DAYS[range]),
    );

    return {
      range,
      generated_at: now.toISOString(),
      count: stats.count,
      avg_length: stats.avgLength,
      histogram: MESSAGE_BUCKETS.map((bucket, i) => ({
        ...bucket,
        count: stats.buckets[i],
      })),
    };
  }

  async getSignupTrend(): Promise<ManagerDashboardSignupTrendDto> {
    const now = new Date();
    const days = recentDays(now, TREND_DAYS);
    const weeks = recentWeeks(now, TREND_WEEKS);
    const [dayRows, weekRows] = await Promise.all([
      this.dashboard.signupBuckets("day", dayStart(days[0])),
      this.dashboard.signupBuckets("week", dayStart(weeks[0])),
    ]);

    const toPoints = (keys: string[], rows: typeof dayRows) =>
      keys.map((date) => ({
        date,
        student:
          rows.find((r) => r.key === date && r.type === "student")?.count ?? 0,
        graduated:
          rows.find((r) => r.key === date && r.type === "graduated")?.count ??
          0,
      }));

    return {
      generated_at: now.toISOString(),
      daily: toPoints(days, dayRows),
      weekly: toPoints(weeks, weekRows),
    };
  }
}
