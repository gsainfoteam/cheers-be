import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "@src/database/database.service";
import {
  CoffeeChatRequestRepository,
  NotificationTargetRow,
} from "@src/database/repository/coffee-chat-request.repository";
import { TxType } from "@src/global/types/tx.types";
import {
  NotificationLogRepository,
  NotificationLogRow,
} from "@src/notification/notification-log.repository";
import { NotificationService } from "@src/notification/notification.service";
import { NotifyInput } from "@src/notification/notification.types";
import { CheersNotificationRetryService } from "./cheers-notification-retry.service";
import { CheersNotificationBuilder } from "./cheers-notification.builder";

const now = new Date("2026-11-07T03:00:00.000Z");

const failedLog = (
  overrides: Partial<NotificationLogRow> = {},
): NotificationLogRow => ({
  pk: "log-1",
  coffeeChatRequestPk: "request-pk",
  event: "coffee_chat_requested",
  channel: "kakao_alimtalk",
  status: "failed",
  createdAt: now,
  providerMessageId: null,
  recipient: "01012345678",
  error: "3040 failed",
  attempt: 1,
  nextRetryAt: now,
  ...overrides,
});

const contact = {
  kakaoEnabled: true,
  emailEnabled: true,
  phone: "01012345678",
  email: "someone@example.com",
};

const target = (
  overrides: Partial<NotificationTargetRow> = {},
): NotificationTargetRow => ({
  pk: "request-pk",
  graduatedName: "김현업",
  graduatedActive: true,
  graduatedContact: contact,
  studentName: "홍길동",
  studentActive: true,
  studentContact: contact,
  ...overrides,
});

describe("CheersNotificationRetryService", () => {
  const tx = {} as TxType;
  const dbService = {
    db: {
      transaction: jest.fn((fn: (tx: TxType) => unknown) => fn(tx)),
    },
  };
  const logRepository = {
    findRetryDuePks: jest.fn(),
    lockRetryDue: jest.fn(),
    clearNextRetry: jest.fn(),
  };
  const requestRepository = { findNotificationTarget: jest.fn() };
  const notificationService = { resend: jest.fn() };
  const service = new CheersNotificationRetryService(
    dbService as unknown as DatabaseService,
    logRepository as unknown as NotificationLogRepository,
    requestRepository as unknown as CoffeeChatRequestRepository,
    notificationService as unknown as NotificationService,
    new CheersNotificationBuilder({
      get: (key: string) =>
        ({ WEB_BASE_URL: "https://cheers.example.com" })[key],
    } as unknown as ConfigService),
  );

  const resentInput = () =>
    (
      notificationService.resend.mock.lastCall as [
        NotificationLogRow,
        NotifyInput,
        TxType,
      ]
    )[1];

  beforeEach(() => {
    jest.clearAllMocks();
    // 첫 조회에 대상, 다음 조회에 없음
    logRepository.findRetryDuePks
      .mockResolvedValueOnce(["log-1"])
      .mockResolvedValue([]);
    logRepository.lockRetryDue.mockResolvedValue(failedLog());
    requestRepository.findNotificationTarget.mockResolvedValue(target());
    notificationService.resend.mockResolvedValue("sent");
  });

  it("resends the failed channel to the graduated with the current contact and clears the retry", async () => {
    await expect(service.retryDue(now)).resolves.toEqual({
      sent: 1,
      failed: 0,
      gaveUp: 0,
      dropped: 0,
    });

    // 이번 실행에서 시도한 로그는 다시 조회하지 않음 (같은 배열을 넘기므로 마지막 값으로 확인)
    expect(logRepository.findRetryDuePks).toHaveBeenCalledTimes(2);
    expect(logRepository.findRetryDuePks).toHaveBeenLastCalledWith(now, 50, [
      "log-1",
    ]);
    expect(logRepository.lockRetryDue).toHaveBeenCalledWith("log-1", now, tx);
    expect(requestRepository.findNotificationTarget).toHaveBeenCalledWith(
      "request-pk",
      tx,
    );
    const input = resentInput();
    expect(input.event).toBe("coffee_chat_requested");
    expect(input.alimtalk).toEqual({
      to: "01012345678",
      variables: { recipientName: "김현업", coffeeChatRequestPk: "request-pk" },
    });
    expect(notificationService.resend).toHaveBeenCalledWith(
      failedLog(),
      input,
      tx,
    );
    expect(logRepository.clearNextRetry).toHaveBeenCalledWith("log-1", tx);
  });

  it("builds the contact_shared notification for the student", async () => {
    logRepository.lockRetryDue.mockResolvedValue(
      failedLog({ event: "contact_shared", channel: "email" }),
    );

    await service.retryDue(now);

    const input = resentInput();
    expect(input.event).toBe("contact_shared");
    expect(input.email?.to).toBe("someone@example.com");
    expect(input.alimtalk?.variables).toEqual({
      recipientName: "홍길동",
      graduatedName: "김현업",
      coffeeChatRequestPk: "request-pk",
    });
  });

  it.each([
    ["the recipient withdrew", target({ graduatedActive: false })],
    [
      "the recipient turned the channel off",
      target({ graduatedContact: { ...contact, kakaoEnabled: false } }),
    ],
    [
      "the recipient has no contact settings",
      target({ graduatedContact: null }),
    ],
  ])("stops retrying when %s", async (_, row) => {
    requestRepository.findNotificationTarget.mockResolvedValue(row);

    await expect(service.retryDue(now)).resolves.toMatchObject({
      dropped: 1,
    });
    expect(notificationService.resend).not.toHaveBeenCalled();
    expect(logRepository.clearNextRetry).toHaveBeenCalledWith("log-1", tx);
  });

  it("skips a log locked by another instance or already retried", async () => {
    logRepository.lockRetryDue.mockResolvedValue(null);

    await expect(service.retryDue(now)).resolves.toEqual({
      sent: 0,
      failed: 0,
      gaveUp: 0,
      dropped: 0,
    });
    expect(notificationService.resend).not.toHaveBeenCalled();
    expect(logRepository.clearNextRetry).not.toHaveBeenCalled();
  });

  it("counts failures and give-ups", async () => {
    logRepository.findRetryDuePks
      .mockReset()
      .mockResolvedValueOnce(["log-1", "log-2"])
      .mockResolvedValue([]);
    notificationService.resend
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("gave_up");

    await expect(service.retryDue(now)).resolves.toEqual({
      sent: 0,
      failed: 1,
      gaveUp: 1,
      dropped: 0,
    });
  });

  it("moves on to the next log when one fails", async () => {
    logRepository.findRetryDuePks
      .mockReset()
      .mockResolvedValueOnce(["log-1", "log-2"])
      .mockResolvedValue([]);
    notificationService.resend
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce("sent");

    await expect(service.retryDue(now)).resolves.toMatchObject({ sent: 1 });
    expect(notificationService.resend).toHaveBeenCalledTimes(2);
  });
});
