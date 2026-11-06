import { Logger } from "@nestjs/common";
import { SlackService } from "nestjs-slack";
import { MailService } from "@src/mail/mail.service";
import { SendMailInput } from "@src/mail/mail.types";
import { AlimtalkService } from "./alimtalk.service";
import { TxType } from "@src/global/types/tx.types";
import {
  NotificationLogRepository,
  NotificationLogRow,
} from "./notification-log.repository";
import { NotificationService } from "./notification.service";
import { NotifyInput } from "./notification.types";

const email: SendMailInput = {
  to: "gildong@gm.gist.ac.kr",
  subject: "subject",
  html: "<p>html</p>",
  text: "text",
};

const input: NotifyInput<"contact_shared"> = {
  coffeeChatRequestPk: "request-pk",
  event: "contact_shared",
  email,
  alimtalk: {
    to: "01012345678",
    variables: {
      recipientName: "홍길동",
      graduatedName: "김현업",
      coffeeChatRequestPk: "request-pk",
    },
  },
};

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const now = new Date("2026-11-07T03:00:00.000Z");

// 실패해서 재시도를 기다리는 로그
const failedLog = (
  overrides: Partial<NotificationLogRow> = {},
): NotificationLogRow => ({
  pk: "log-pk",
  coffeeChatRequestPk: "request-pk",
  event: "contact_shared",
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

describe("NotificationService", () => {
  const mailSend = jest.fn();
  const alimtalkSend = jest.fn();
  const insert = jest.fn();
  const sendText = jest.fn();

  const service = new NotificationService(
    { send: mailSend } as unknown as MailService,
    { send: alimtalkSend } as unknown as AlimtalkService,
    { insert } as unknown as NotificationLogRepository,
    { sendText } as unknown as SlackService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now, doNotFake: ["setImmediate"] });
    insert.mockResolvedValue(undefined);
    sendText.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("sends every given channel and logs each result", async () => {
    mailSend.mockResolvedValue({ success: true, messageId: "<id@gmail.com>" });
    alimtalkSend.mockResolvedValue({ success: true, messageId: "M4V1" });

    await service.notify(input);

    expect(mailSend).toHaveBeenCalledWith(email);
    expect(alimtalkSend).toHaveBeenCalledWith({
      event: "contact_shared",
      to: "01012345678",
      variables: input.alimtalk!.variables,
    });
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenCalledWith(
      {
        coffeeChatRequestPk: "request-pk",
        event: "contact_shared",
        channel: "email",
        status: "sent",
        recipient: "gildong@gm.gist.ac.kr",
        providerMessageId: "<id@gmail.com>",
        error: undefined,
        attempt: 1,
        nextRetryAt: null,
      },
      undefined,
    );
    expect(insert).toHaveBeenCalledWith(
      {
        coffeeChatRequestPk: "request-pk",
        event: "contact_shared",
        channel: "kakao_alimtalk",
        status: "sent",
        recipient: "01012345678",
        providerMessageId: "M4V1",
        error: undefined,
        attempt: 1,
        nextRetryAt: null,
      },
      undefined,
    );
    expect(sendText).not.toHaveBeenCalled();
  });

  it("logs a failed channel for retry in 1 minute and still sends the other one", async () => {
    mailSend.mockResolvedValue({ success: true, messageId: "<id@gmail.com>" });
    alimtalkSend.mockResolvedValue({
      success: false,
      messageId: "M4V2",
      error: "3040 등록되지 않은 발신번호입니다.",
    });

    await service.notify(input);

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "email",
        status: "sent",
        nextRetryAt: null,
      }),
      undefined,
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "kakao_alimtalk",
        status: "failed",
        providerMessageId: "M4V2",
        error: "3040 등록되지 않은 발신번호입니다.",
        attempt: 1,
        nextRetryAt: new Date("2026-11-07T03:01:00.000Z"),
      }),
      undefined,
    );
    // 재시도할 실패는 Slack으로 알리지 않음
    expect(sendText).not.toHaveBeenCalled();
  });

  describe("resend", () => {
    const tx = {} as TxType;

    it.each([
      [1, "failed", new Date("2026-11-07T03:05:00.000Z")],
      [2, "failed", new Date("2026-11-07T03:30:00.000Z")],
    ])(
      "logs attempt %i + 1 as failed with the next delay",
      async (attempt, outcome, nextRetryAt) => {
        alimtalkSend.mockResolvedValue({
          success: false,
          error: "3040 failed",
        });

        await expect(
          service.resend(failedLog({ attempt }), input, tx),
        ).resolves.toBe(outcome);

        expect(mailSend).not.toHaveBeenCalled();
        expect(insert).toHaveBeenCalledWith(
          expect.objectContaining({
            channel: "kakao_alimtalk",
            status: "failed",
            attempt: attempt + 1,
            nextRetryAt,
          }),
          tx,
        );
        expect(sendText).not.toHaveBeenCalled();
      },
    );

    it("gives up after the 3rd retry and notifies slack with the recipient masked", async () => {
      mailSend.mockResolvedValue({
        success: false,
        error: "550 gildong@gm.gist.ac.kr does not exist",
      });

      await expect(
        service.resend(failedLog({ channel: "email", attempt: 3 }), input, tx),
      ).resolves.toBe("gave_up");

      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "email",
          status: "failed",
          attempt: 4,
          nextRetryAt: null,
          // notification_log에는 원문을 남김
          recipient: "gildong@gm.gist.ac.kr",
        }),
        tx,
      );
      const [[message, options]] = sendText.mock.calls as [[string, object]];
      expect(message).toContain("NOTIFICATION GAVE UP");
      expect(message).toContain("gi***@gm.gist.ac.kr");
      expect(message).not.toContain("gildong@gm.gist.ac.kr");
      expect(options).toEqual({ channel: "bug" });
    });

    it("logs a successful resend with the next attempt", async () => {
      alimtalkSend.mockResolvedValue({ success: true, messageId: "M4V3" });

      await expect(service.resend(failedLog(), input, tx)).resolves.toBe(
        "sent",
      );

      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "sent",
          attempt: 2,
          nextRetryAt: null,
        }),
        tx,
      );
    });

    it("does not log a skipped resend", async () => {
      alimtalkSend.mockResolvedValue({ success: true, skipped: true });

      await expect(service.resend(failedLog(), input, tx)).resolves.toBe(
        "skipped",
      );
      expect(insert).not.toHaveBeenCalled();
    });

    it("rethrows when writing the log fails so the retry is rolled back", async () => {
      alimtalkSend.mockResolvedValue({ success: true, messageId: "M4V3" });
      insert.mockRejectedValue(new Error("db down"));

      await expect(service.resend(failedLog(), input, tx)).rejects.toThrow(
        "db down",
      );
      expect(sendText).toHaveBeenCalledWith(
        expect.stringContaining("db down"),
        { channel: "bug" },
      );
    });
  });

  it("sends only the channels that are given", async () => {
    mailSend.mockResolvedValue({ success: true, messageId: "<id@gmail.com>" });

    await service.notify({ ...input, alimtalk: undefined });

    expect(alimtalkSend).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("does not log skipped sends", async () => {
    mailSend.mockResolvedValue({ success: true, skipped: true });
    alimtalkSend.mockResolvedValue({ success: true, skipped: true });

    await service.notify(input);

    expect(insert).not.toHaveBeenCalled();
  });

  it("does not throw and notifies slack when writing the log fails", async () => {
    mailSend.mockResolvedValue({ success: true, messageId: "<id@gmail.com>" });
    insert.mockRejectedValue(new Error("db down"));

    await expect(
      service.notify({ ...input, alimtalk: undefined }),
    ).resolves.toBeUndefined();
    expect(sendText).toHaveBeenCalledWith(expect.stringContaining("db down"), {
      channel: "bug",
    });
  });

  it("notifyAsync returns immediately and sends in the background", async () => {
    mailSend.mockResolvedValue({ success: true, messageId: "<id@gmail.com>" });
    alimtalkSend.mockResolvedValue({ success: true, messageId: "M4V1" });

    expect(service.notifyAsync(input)).toBeUndefined();
    await flushPromises();

    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("notifyAsync catches unexpected rejections", async () => {
    const error = jest.spyOn(Logger.prototype, "error").mockImplementation();
    const unhandled = jest.fn();
    process.on("unhandledRejection", unhandled);
    mailSend.mockRejectedValue(new Error("unexpected"));

    service.notifyAsync({ ...input, alimtalk: undefined });
    await flushPromises();

    expect(unhandled).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Unexpected error while notifying"),
      expect.any(Error),
    );
    process.off("unhandledRejection", unhandled);
    error.mockRestore();
  });
});
