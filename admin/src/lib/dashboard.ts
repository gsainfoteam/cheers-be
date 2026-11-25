export const DASHBOARD_BASE_PATH = "/api/manager/v1/dashboard";

export const DASHBOARD_RANGES = ["7d", "30d", "90d"] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];
export const DASHBOARD_RANGE_LABELS: Record<DashboardRange, string> = {
  "7d": "최근 7일",
  "30d": "최근 30일",
  "90d": "최근 90일",
};

export type DashboardCoffeeChat = {
  range: DashboardRange;
  generated_at: string;
  funnel: {
    requested: number;
    graduated_viewed: number;
    contact_shared: number;
    student_viewed: number;
    // 분모가 0이면 null
    rates: {
      viewed: number | null;
      contact_shared: number | null;
    };
    avg_hours: {
      to_viewed: number | null;
      to_shared: number | null;
    };
    stale: { unviewed_3d: number; unshared_3d: number };
  };
  monthly_requests: { month: string; count: number }[];
};

export type DashboardMemberType = {
  active: number;
  pending: number;
  new: number;
  active_7d: number;
  active_30d: number;
};

export type DashboardMember = {
  range: DashboardRange;
  generated_at: string;
  student: DashboardMemberType;
  graduated: DashboardMemberType;
  withdraw_pending: number;
};

export type DashboardNameCount = { name: string; count: number };

export type DashboardDemand = {
  range: DashboardRange;
  generated_at: string;
  departments: DashboardNameCount[];
  companies: DashboardNameCount[];
  interests: DashboardNameCount[];
  graduated_requested_ratio: number | null;
  student_requested_ratio: number | null;
};

export type DashboardTodo = {
  generated_at: string;
  business_card_pending: number;
  company_needs_review: number;
  notification: {
    failed: number;
    retry_waiting: number;
    delivery_unknown: number;
  };
};

export const formatCount = (value: number) => value.toLocaleString("ko-KR");

// 0.256 → "25.6%". 분모가 0이라 알 수 없으면 "-"
export const formatPercent = (value: number | null) =>
  value === null ? "-" : `${(value * 100).toFixed(1)}%`;

// 시간 → "3.5시간" · "2.1일". 알 수 없으면 "-"
export const formatHours = (value: number | null) => {
  if (value === null) return "-";
  return value >= 48
    ? `${(value / 24).toFixed(1)}일`
    : `${value.toFixed(1)}시간`;
};
