import { Logger } from "@nestjs/common";
import { SlackService } from "nestjs-slack";
import { AlimtalkService } from "./alimtalk.service";
import { NotificationDeliverySyncService } from "./notification-delivery-sync.service";
import {
  DeliveryCheckRow,
  NotificationLogRepository,
} from "./notification-log.repository";

const now = new Date("2026-11-08T03:00:00.000Z");
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const ago = (ms: number) => new Date(now.getTime() - ms);
const later = (ms: number) => new Date(now.getTime() + ms);

const row = (overrides: Partial<DeliveryCheckRow> = {}): DeliveryCheckRow => ({
  pk: "log-1",
  coffeeChatRequestPk: "request-pk",
  event: "coffee_chat_requested",
  attempt: 1,
  createdAt: ago(MINUTE_MS),
  recipient: "01012345678",
  providerMessageId: "123456788",
  ...overrides,
});

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

describe("NotificationDeliverySyncService", () => {
  const claimDeliveryCheckDue = jest.fn();
  const updateDelivery = jest.fn();
  const fetchResult = jest.fn();
  const sendText = jest.fn();

  const service = new NotificationDeliverySyncService(
    {
      claimDeliveryCheckDue,
      updateDelivery,
    } as unknown as NotificationLogRepository,
    { fetchResult } as unknown as AlimtalkService,
    { sendText } as unknown as SlackService,
  );

  // 첫 호출에만 rows를 주고 그다음은 빈 배열
  const claimOnce = (...rows: DeliveryCheckRow[]) =>
    claimDeliveryCheckDue.mockResolvedValueOnce(rows).mockResolvedValue([]);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    updateDelivery.mockResolvedValue(undefined);
    sendText.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("claims due logs with a 5 minute lease until none are left", async () => {
    claimDeliveryCheckDue
      .mockResolvedValueOnce([row({ pk: "a" })])
      .mockResolvedValueOnce([row({ pk: "b" })])
      .mockResolvedValue([]);
    fetchResult.mockResolvedValue({ status: "pending" });

    await service.syncDue(now);

    expect(claimDeliveryCheckDue).toHaveBeenCalledTimes(3);
    expect(claimDeliveryCheckDue).toHaveBeenCalledWith(
      now,
      later(5 * MINUTE_MS),
      50,
    );
    expect(fetchResult).toHaveBeenCalledTimes(2);
  });

  it("stores a delivered result and stops checking", async () => {
    claimOnce(row());
    const reportedAt = ago(30 * 1000);
    fetchResult.mockResolvedValue({
      status: "delivered",
      code: "0",
      message: "성공",
      reportedAt,
    });

    const result = await service.syncDue(now);

    expect(fetchResult).toHaveBeenCalledWith("123456788");
    expect(updateDelivery).toHaveBeenCalledWith("log-1", {
      deliveryStatus: "delivered",
      deliveryCode: "0",
      deliveryMessage: "성공",
      deliveryReportedAt: reportedAt,
      deliveryNextCheckAt: null,
    });
    expect(result).toEqual({ delivered: 1, failed: 0, unknown: 0, pending: 0 });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("stores a kakao failure as is and alerts Slack with the phone masked", async () => {
    claimOnce(row());
    fetchResult.mockResolvedValue({
      status: "failed",
      code: "U",
      message: "메시지가 템플릿과 일치하지않음 (01012345678)",
      reportedAt: null,
    });

    const result = await service.syncDue(now);
    await flushPromises();

    // DB에는 원문 (어드민 응답에서 가림)
    expect(updateDelivery).toHaveBeenCalledWith("log-1", {
      deliveryStatus: "failed",
      deliveryCode: "U",
      deliveryMessage: "메시지가 템플릿과 일치하지않음 (01012345678)",
      deliveryReportedAt: null,
      deliveryNextCheckAt: null,
    });
    expect(result.failed).toBe(1);
    expect(sendText).toHaveBeenCalledTimes(1);
    const [text, options] = sendText.mock.calls[0];
    expect(text).toContain("ALIMTALK DELIVERY FAILED");
    expect(text).toContain("mid: 123456788");
    expect(text).toContain("U 메시지가 템플릿과 일치하지않음 (010****5678)");
    expect(text).not.toContain("01012345678");
    expect(options).toEqual({ channel: "bug" });
  });

  it.each([
    ["pending", { status: "pending" }],
    ["error", { status: "error", error: "-101 인증오류입니다." }],
  ])(
    "checks again in 5 minutes within the first hour (%s)",
    async (_, delivery) => {
      claimOnce(row({ createdAt: ago(59 * MINUTE_MS) }));
      fetchResult.mockResolvedValue(delivery);

      const result = await service.syncDue(now);

      expect(updateDelivery).toHaveBeenCalledWith("log-1", {
        deliveryNextCheckAt: later(5 * MINUTE_MS),
      });
      expect(result.pending).toBe(1);
      expect(sendText).not.toHaveBeenCalled();
    },
  );

  it("checks again in 1 hour after the first hour", async () => {
    claimOnce(row({ createdAt: ago(HOUR_MS) }));
    fetchResult.mockResolvedValue({ status: "pending" });

    await service.syncDue(now);

    expect(updateDelivery).toHaveBeenCalledWith("log-1", {
      deliveryNextCheckAt: later(HOUR_MS),
    });
  });

  it("still checks just before 25 hours", async () => {
    claimOnce(row({ createdAt: ago(25 * HOUR_MS - 1) }));
    fetchResult.mockResolvedValue({ status: "pending" });

    const result = await service.syncDue(now);

    expect(result.pending).toBe(1);
  });

  it("gives up as unknown when there is still no result after 25 hours", async () => {
    claimOnce(row({ createdAt: ago(25 * HOUR_MS) }));
    fetchResult.mockResolvedValue({ status: "pending" });

    const result = await service.syncDue(now);
    await flushPromises();

    expect(updateDelivery).toHaveBeenCalledWith("log-1", {
      deliveryStatus: "unknown",
      deliveryMessage: null,
      deliveryNextCheckAt: null,
    });
    expect(result).toEqual({ delivered: 0, failed: 0, unknown: 1, pending: 0 });
    expect(sendText).toHaveBeenCalledWith(
      expect.stringContaining("ALIMTALK DELIVERY UNKNOWN"),
      { channel: "bug" },
    );
  });

  it("keeps the last lookup error when giving up", async () => {
    claimOnce(row({ createdAt: ago(26 * HOUR_MS) }));
    fetchResult.mockResolvedValue({
      status: "error",
      error: "-101 인증오류입니다.",
    });

    await service.syncDue(now);

    expect(updateDelivery).toHaveBeenCalledWith("log-1", {
      deliveryStatus: "unknown",
      deliveryMessage: "-101 인증오류입니다.",
      deliveryNextCheckAt: null,
    });
  });

  it("uses the final result of an old log instead of giving up", async () => {
    // 백필된 오래된 로그도 결과가 있으면 그대로 확정
    claimOnce(row({ createdAt: ago(48 * HOUR_MS) }));
    fetchResult.mockResolvedValue({
      status: "delivered",
      code: "0",
      message: null,
      reportedAt: null,
    });

    const result = await service.syncDue(now);

    expect(result.delivered).toBe(1);
  });

  it("continues with the next log when one fails to save", async () => {
    claimOnce(row({ pk: "a" }), row({ pk: "b" }));
    fetchResult.mockResolvedValue({ status: "pending" });
    updateDelivery
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValue(undefined);

    const result = await service.syncDue(now);

    expect(updateDelivery).toHaveBeenCalledTimes(2);
    expect(result.pending).toBe(1);
  });
});
