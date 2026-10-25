import { Logger } from "@nestjs/common";
import { SlackService } from "nestjs-slack";
import { MailService } from "@src/mail/mail.service";
import { SendMailInput } from "@src/mail/mail.types";
import { AlimtalkService } from "./alimtalk.service";
import { NotificationLogRepository } from "./notification-log.repository";
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
    insert.mockResolvedValue(undefined);
    sendText.mockResolvedValue(undefined);
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
    expect(insert).toHaveBeenCalledWith({
      coffeeChatRequestPk: "request-pk",
      event: "contact_shared",
      channel: "email",
      status: "sent",
      recipient: "gildong@gm.gist.ac.kr",
      providerMessageId: "<id@gmail.com>",
      error: undefined,
    });
    expect(insert).toHaveBeenCalledWith({
      coffeeChatRequestPk: "request-pk",
      event: "contact_shared",
      channel: "kakao_alimtalk",
      status: "sent",
      recipient: "01012345678",
      providerMessageId: "M4V1",
      error: undefined,
    });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("logs a failed channel and still sends the other one", async () => {
    mailSend.mockResolvedValue({ success: true, messageId: "<id@gmail.com>" });
    alimtalkSend.mockResolvedValue({
      success: false,
      messageId: "M4V2",
      error: "3040 등록되지 않은 발신번호입니다.",
    });

    await service.notify(input);

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "email", status: "sent" }),
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "kakao_alimtalk",
        status: "failed",
        providerMessageId: "M4V2",
        error: "3040 등록되지 않은 발신번호입니다.",
      }),
    );
    expect(sendText).toHaveBeenCalledWith(expect.stringContaining("3040"), {
      channel: "bug",
    });
  });

  it("masks the recipient in the slack alert", async () => {
    mailSend.mockResolvedValue({
      success: false,
      error: "550 gildong@gm.gist.ac.kr does not exist",
    });
    alimtalkSend.mockResolvedValue({ success: false, error: "3040 failed" });

    await service.notify(input);

    const messages = sendText.mock.calls.map(([text]) => text).join("\n");
    expect(messages).toContain("gi***@gm.gist.ac.kr");
    expect(messages).toContain("010****5678");
    expect(messages).not.toContain("gildong@gm.gist.ac.kr");
    expect(messages).not.toContain("01012345678");
    // notification_log에는 원문을 남김
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "email",
        recipient: "gildong@gm.gist.ac.kr",
      }),
    );
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
