import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac } from "node:crypto";
import { AlimtalkService } from "./alimtalk.service";
import { SendAlimtalkInput } from "./alimtalk.types";

const input: SendAlimtalkInput<"contact_shared"> = {
  event: "contact_shared",
  to: "01012345678",
  variables: {
    recipientName: "홍길동",
    graduatedName: "김현업",
    coffeeChatRequestPk: "request-pk",
  },
};

const config = {
  SOLAPI_API_KEY: "api-key",
  SOLAPI_API_SECRET: "api-secret",
  SOLAPI_SENDER_PHONE: "0212345678",
  KAKAO_PF_ID: "PF-ID",
  KAKAO_TEMPLATE_COFFEE_CHAT_REQUESTED: "TPL-REQUESTED",
  KAKAO_TEMPLATE_CONTACT_SHARED: "TPL-SHARED",
};

const textResponse = (text: string, ok = true, status = 200) =>
  ({ ok, status, text: () => Promise.resolve(text) }) as Response;

const jsonResponse = (body: unknown, ok = true, status = 200) =>
  textResponse(JSON.stringify(body), ok, status);

describe("AlimtalkService", () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  const createService = (env: Record<string, string | undefined>) =>
    new AlimtalkService({
      get: (key: string) => env[key],
    } as unknown as ConfigService);

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("sends alimtalk through solapi and returns the message id", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        messageList: [{ messageId: "M4V1", statusCode: "2000" }],
      }),
    );
    const service = createService(config);

    const result = await service.send(input);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.solapi.com/messages/v4/send-many/detail");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      messages: [
        {
          to: "01012345678",
          from: "0212345678",
          type: "ATA",
          kakaoOptions: {
            pfId: "PF-ID",
            templateId: "TPL-SHARED",
            variables: {
              "#{이름}": "홍길동",
              "#{현업자이름}": "김현업",
              "#{요청ID}": "request-pk",
            },
            disableSms: true,
          },
        },
      ],
      showMessageList: true,
    });
    expect(result).toEqual({ success: true, messageId: "M4V1" });
  });

  it("signs the request with HMAC-SHA256 of date + salt", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ messageList: [] }));
    const service = createService(config);

    await service.send(input);

    const authorization: string =
      fetchMock.mock.calls[0][1].headers.Authorization;
    const match = authorization.match(
      /^HMAC-SHA256 apiKey=api-key, date=(\S+), salt=([0-9a-f]+), signature=([0-9a-f]{64})$/,
    );
    expect(match).not.toBeNull();
    const [, date, salt, signature] = match!;
    expect(signature).toBe(
      createHmac("sha256", "api-secret")
        .update(date + salt)
        .digest("hex"),
    );
  });

  it("uses the template of the event", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ messageList: [] }));
    const service = createService(config);

    await service.send({
      event: "coffee_chat_requested",
      to: "01012345678",
      variables: { recipientName: "김현업", coffeeChatRequestPk: "request-pk" },
    });

    const { kakaoOptions } = JSON.parse(fetchMock.mock.calls[0][1].body)
      .messages[0];
    expect(kakaoOptions.templateId).toBe("TPL-REQUESTED");
    expect(kakaoOptions.variables).toEqual({
      "#{이름}": "김현업",
      "#{요청ID}": "request-pk",
    });
  });

  it("returns failure when solapi rejects the message", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        failedMessageList: [
          {
            messageId: "M4V2",
            statusCode: "3040",
            statusMessage: "등록되지 않은 발신번호입니다.",
          },
        ],
      }),
    );
    const service = createService(config);

    await expect(service.send(input)).resolves.toEqual({
      success: false,
      messageId: "M4V2",
      error: "3040 등록되지 않은 발신번호입니다.",
    });
  });

  it("returns failure on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { errorCode: "InvalidApiKey", errorMessage: "invalid key" },
        false,
        401,
      ),
    );
    const service = createService(config);

    await expect(service.send(input)).resolves.toEqual({
      success: false,
      error: "401 InvalidApiKey invalid key",
    });
  });

  it("keeps the status code when the error body is not json", async () => {
    fetchMock.mockResolvedValue(
      textResponse("<html>502 Bad Gateway</html>", false, 502),
    );
    const service = createService(config);

    await expect(service.send(input)).resolves.toEqual({
      success: false,
      error: "502",
    });
  });

  it("returns failure when a 2xx body is not json", async () => {
    fetchMock.mockResolvedValue(textResponse("<html></html>"));
    const service = createService(config);

    await expect(service.send(input)).resolves.toEqual({
      success: false,
      error: "200 invalid response body",
    });
  });

  it("returns failure instead of throwing when the request fails", async () => {
    fetchMock.mockRejectedValue(new Error("The operation was aborted"));
    const service = createService(config);

    await expect(service.send(input)).resolves.toEqual({
      success: false,
      error: "The operation was aborted",
    });
  });

  it("skips sending when config is not set, even in production", async () => {
    const service = createService({ NODE_ENV: "production" });

    await expect(service.send(input)).resolves.toEqual({
      success: true,
      skipped: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("masks the phone number in the skip log", async () => {
    const log = jest.spyOn(Logger.prototype, "log").mockImplementation();
    const service = createService({});

    await service.send(input);

    expect(log).toHaveBeenCalledWith(
      "[ALIMTALK SKIPPED] to=010****5678 event=contact_shared",
    );
    log.mockRestore();
  });
});
