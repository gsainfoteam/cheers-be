import { ConfigService } from "@nestjs/config";
import { SlackService } from "nestjs-slack";
import { createTransport } from "nodemailer";
import { MailService } from "./mail.service";
import { SendMailInput } from "./mail.types";

jest.mock("nodemailer", () => ({ createTransport: jest.fn() }));

const input: SendMailInput = {
  to: "gildong@gm.gist.ac.kr",
  subject: "subject",
  html: "<p>html</p>",
  text: "text",
};

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

describe("MailService", () => {
  const sendMail = jest.fn();
  const sendText = jest.fn();
  const slackService = { sendText } as unknown as SlackService;

  const createService = (env: Record<string, string | undefined>) =>
    new MailService(
      { get: (key: string) => env[key] } as unknown as ConfigService,
      slackService,
    );

  const credentials = {
    MAIL_USER: "cheers@gmail.com",
    MAIL_APP_PASSWORD: "app-password",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (createTransport as jest.Mock).mockReturnValue({ sendMail });
    sendText.mockResolvedValue(undefined);
  });

  it("sends mail through gmail and returns the message id", async () => {
    sendMail.mockResolvedValue({ messageId: "<id@gmail.com>" });
    const service = createService(credentials);

    const result = await service.send(input);

    expect(createTransport).toHaveBeenCalledWith({
      service: "gmail",
      auth: { user: "cheers@gmail.com", pass: "app-password" },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: '"취얼스" <cheers@gmail.com>',
      ...input,
    });
    expect(result).toEqual({ success: true, messageId: "<id@gmail.com>" });
  });

  it("returns failure instead of throwing when sending fails", async () => {
    sendMail.mockRejectedValue(new Error("SMTP error"));
    const service = createService(credentials);

    await expect(service.send(input)).resolves.toEqual({
      success: false,
      error: "SMTP error",
    });
  });

  it("skips sending when credentials are not set", async () => {
    const service = createService({});

    await expect(service.send(input)).resolves.toEqual({ success: true });
    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("throws on startup when credentials are not set in production", () => {
    expect(() => createService({ NODE_ENV: "production" })).toThrow(
      "MAIL_USER and MAIL_APP_PASSWORD are required in production.",
    );
  });

  it("sendAsync returns immediately and notifies slack on failure", async () => {
    sendMail.mockRejectedValue(new Error("SMTP error"));
    const service = createService(credentials);

    expect(service.sendAsync(input)).toBeUndefined();
    await flushPromises();

    expect(sendText).toHaveBeenCalledWith(
      expect.stringContaining("SMTP error"),
      { channel: "bug" },
    );
  });

  it("sendAsync does not notify slack on success", async () => {
    sendMail.mockResolvedValue({ messageId: "<id@gmail.com>" });
    const service = createService(credentials);

    service.sendAsync(input);
    await flushPromises();

    expect(sendText).not.toHaveBeenCalled();
  });
});
