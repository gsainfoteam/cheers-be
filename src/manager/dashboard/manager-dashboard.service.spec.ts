import { AdminDashboardRepository } from "@src/admin-repository/admin-dashboard.repository";
import {
  ManagerDashboardService,
  recentMonths,
} from "@src/manager/dashboard/manager-dashboard.service";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("recentMonths", () => {
  it("Asia/Seoul 기준 최근 n개월을 오래된 순으로 만든다", () => {
    // UTC로는 10월 31일이지만 KST로는 11월 1일
    expect(recentMonths(new Date("2026-10-31T16:00:00Z"), 3)).toEqual([
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
  });

  it("해를 넘겨도 이어진다", () => {
    expect(recentMonths(new Date("2026-02-10T00:00:00Z"), 4)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });
});

describe("ManagerDashboardService", () => {
  const repository = {
    coffeeChatFunnel: jest.fn(),
    staleRequests: jest.fn(),
    monthlyRequests: jest.fn(),
    memberStats: jest.fn(),
    countWithdrawPending: jest.fn(),
    topDepartments: jest.fn(),
    topCompanies: jest.fn(),
    topInterests: jest.fn(),
    requesterCounts: jest.fn(),
    countBusinessCardPending: jest.fn(),
    countCompanyNeedsReview: jest.fn(),
    notificationCounts: jest.fn(),
  };
  const service = new ManagerDashboardService(
    repository as unknown as AdminDashboardRepository,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(new Date("2026-11-15T00:00:00Z"));
  });
  afterAll(() => jest.useRealTimers());

  describe("getCoffeeChat", () => {
    const funnel = (overrides: object = {}) => ({
      requested: 10,
      graduatedViewed: 8,
      accepted: 4,
      contactShared: 2,
      studentViewed: 1,
      hoursToViewed: 3.5,
      hoursToAccepted: null,
      hoursToShared: null,
      ...overrides,
    });

    it("range를 기간으로 바꿔 퍼널을 조회하고 전환율을 계산한다", async () => {
      repository.coffeeChatFunnel.mockResolvedValue(funnel());
      repository.staleRequests.mockResolvedValue({
        unviewed: 2,
        unaccepted: 1,
      });
      repository.monthlyRequests.mockResolvedValue([]);

      const result = await service.getCoffeeChat("7d");

      expect(repository.coffeeChatFunnel).toHaveBeenCalledWith(
        new Date(Date.now() - 7 * DAY_MS),
      );
      expect(repository.staleRequests).toHaveBeenCalledWith(
        new Date(Date.now() - 3 * DAY_MS),
      );
      expect(result.range).toBe("7d");
      expect(result.funnel.rates).toEqual({
        viewed: 0.8,
        accepted: 0.5,
        contact_shared: 0.5,
      });
      expect(result.funnel.avg_hours.to_viewed).toBe(3.5);
      expect(result.funnel.stale).toEqual({ unviewed_3d: 2, unaccepted_3d: 1 });
    });

    it("range를 생략하면 30d로 조회한다", async () => {
      repository.coffeeChatFunnel.mockResolvedValue(funnel());
      repository.staleRequests.mockResolvedValue({
        unviewed: 0,
        unaccepted: 0,
      });
      repository.monthlyRequests.mockResolvedValue([]);

      const result = await service.getCoffeeChat();

      expect(result.range).toBe("30d");
      expect(repository.coffeeChatFunnel).toHaveBeenCalledWith(
        new Date(Date.now() - 30 * DAY_MS),
      );
    });

    it("분모가 0이면 전환율은 0이 아니라 null이다", async () => {
      repository.coffeeChatFunnel.mockResolvedValue(
        funnel({
          requested: 0,
          graduatedViewed: 0,
          accepted: 0,
          contactShared: 0,
        }),
      );
      repository.staleRequests.mockResolvedValue({
        unviewed: 0,
        unaccepted: 0,
      });
      repository.monthlyRequests.mockResolvedValue([]);

      const result = await service.getCoffeeChat();

      expect(result.funnel.rates).toEqual({
        viewed: null,
        accepted: null,
        contact_shared: null,
      });
    });

    it("월별 추이는 요청이 없는 달도 0으로 채워 6개월을 내려준다", async () => {
      repository.coffeeChatFunnel.mockResolvedValue(funnel());
      repository.staleRequests.mockResolvedValue({
        unviewed: 0,
        unaccepted: 0,
      });
      repository.monthlyRequests.mockResolvedValue([
        { month: "2026-09", count: 3 },
        { month: "2026-11", count: 5 },
      ]);

      const result = await service.getCoffeeChat();

      expect(result.monthly_requests).toEqual([
        { month: "2026-06", count: 0 },
        { month: "2026-07", count: 0 },
        { month: "2026-08", count: 0 },
        { month: "2026-09", count: 3 },
        { month: "2026-10", count: 0 },
        { month: "2026-11", count: 5 },
      ]);
      // 2026-06-01 00:00 KST
      expect(repository.monthlyRequests).toHaveBeenCalledWith(
        new Date("2026-05-31T15:00:00Z"),
      );
    });
  });

  describe("getMember", () => {
    it("유형별로 나누고, 없는 유형은 0으로 채운다", async () => {
      repository.memberStats.mockResolvedValue([
        {
          type: "student",
          active: 10,
          pending: 2,
          newActive: 3,
          active7d: 5,
          active30d: 8,
        },
      ]);
      repository.countWithdrawPending.mockResolvedValue(1);

      const result = await service.getMember("90d");

      expect(repository.memberStats).toHaveBeenCalledWith(
        new Date(Date.now() - 90 * DAY_MS),
        new Date(Date.now() - 7 * DAY_MS),
        new Date(Date.now() - 30 * DAY_MS),
      );
      expect(result.student).toEqual({
        active: 10,
        pending: 2,
        new: 3,
        active_7d: 5,
        active_30d: 8,
      });
      expect(result.graduated).toEqual({
        active: 0,
        pending: 0,
        new: 0,
        active_7d: 0,
        active_30d: 0,
      });
      expect(result.withdraw_pending).toBe(1);
    });
  });

  describe("getDemand", () => {
    it("TOP 5를 조회하고 요청한 비율을 계산한다", async () => {
      repository.topDepartments.mockResolvedValue([{ name: "전자", count: 4 }]);
      repository.topCompanies.mockResolvedValue([{ name: "인포", count: 3 }]);
      repository.topInterests.mockResolvedValue([{ name: "백엔드", count: 2 }]);
      repository.requesterCounts.mockResolvedValue({
        requestedGraduated: 1,
        requestedStudent: 3,
        activeGraduated: 4,
        activeStudent: 0,
      });

      const result = await service.getDemand("30d");

      const from = new Date(Date.now() - 30 * DAY_MS);
      expect(repository.topDepartments).toHaveBeenCalledWith(from, 5);
      expect(repository.topCompanies).toHaveBeenCalledWith(from, 5);
      expect(repository.topInterests).toHaveBeenCalledWith(from, 5);
      expect(result.departments).toEqual([{ name: "전자", count: 4 }]);
      expect(result.graduated_requested_ratio).toBe(0.25);
      // 활성 재학생이 없으면 0이 아니라 null
      expect(result.student_requested_ratio).toBeNull();
    });
  });

  describe("getTodo", () => {
    it("처리할 일과 최근 7일 알림 상태를 내려준다", async () => {
      repository.countBusinessCardPending.mockResolvedValue(3);
      repository.countCompanyNeedsReview.mockResolvedValue(2);
      repository.notificationCounts.mockResolvedValue({
        failed: 1,
        retryWaiting: 2,
        deliveryUnknown: 3,
      });

      const result = await service.getTodo();

      expect(repository.notificationCounts).toHaveBeenCalledWith(
        new Date(Date.now() - 7 * DAY_MS),
      );
      expect(result).toEqual({
        generated_at: "2026-11-15T00:00:00.000Z",
        business_card_pending: 3,
        company_needs_review: 2,
        notification: { failed: 1, retry_waiting: 2, delivery_unknown: 3 },
      });
    });
  });
});
