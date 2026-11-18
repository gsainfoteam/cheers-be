import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AlimtalkTemplateCache } from "./alimtalk-template.cache";
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
  ALIGO_API_KEY: "api-key",
  ALIGO_USER_ID: "user-id",
  ALIGO_SENDER_KEY: "SENDER-KEY",
  ALIGO_SENDER_PHONE: "0212345678",
  WEB_BASE_URL: "https://cheers.example.com",
};

const templates = {
  coffee_chat_requested: {
    event: "coffee_chat_requested",
    tplCode: "TPL-REQUESTED",
    title: "☕️ 커피챗 요청 안내",
    message:
      "재학생 회원으로부터 새로운 커피챗 요청이 도착했어요\n요청 내용을 확인하고 커피챗 가능 여부를 알려주세요 :)",
    buttonName: "Cheers에서 확인하기",
    updatedAt: new Date(),
  },
  contact_shared: {
    event: "contact_shared",
    tplCode: "TPL-SHARED",
    title: "☕️ 연락처 공유 안내",
    message:
      "회원님의 커피챗 요청에 대해 선배가 연락처를 공유했어요\n연락처를 확인하고 커피챗 일정을 잡아볼까요?",
    buttonName: "Cheers에서 확인하기",
    updatedAt: new Date(),
  },
};

const successBody = {
  code: 0,
  message: "성공적으로 전송요청 하였습니다.",
  info: { type: "AT", mid: 123456789, scnt: 1, fcnt: 0 },
};

const textResponse = (text: string, ok = true, status = 200) =>
  ({ ok, status, text: () => Promise.resolve(text) }) as Response;

const jsonResponse = (body: unknown, ok = true, status = 200) =>
  textResponse(JSON.stringify(body), ok, status);

describe("AlimtalkService", () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  const templateCache = { get: jest.fn() };

  const createService = (env: Record<string, string | undefined>) =>
    new AlimtalkService(
      {
        get: (key: string) => env[key],
      } as unknown as ConfigService,
      templateCache as unknown as AlimtalkTemplateCache,
    );

  const sentParams = () =>
    Object.fromEntries(fetchMock.mock.calls[0][1].body as URLSearchParams);

  beforeEach(() => {
    jest.clearAllMocks();
    templateCache.get.mockImplementation((event: keyof typeof templates) =>
      Promise.resolve(templates[event]),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("sends alimtalk through aligo and returns the message id", async () => {
    fetchMock.mockResolvedValue(jsonResponse(successBody));
    const service = createService(config);

    const result = await service.send(input);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://kakaoapi.aligo.in/akv10/alimtalk/send/");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(URLSearchParams);
    const { button_1: button, ...params } = sentParams();
    expect(params).toEqual({
      apikey: "api-key",
      userid: "user-id",
      senderkey: "SENDER-KEY",
      tpl_code: "TPL-SHARED",
      sender: "0212345678",
      receiver_1: "01012345678",
      recvname_1: "홍길동",
      subject_1: "☕️ 연락처 공유 안내",
      emtitle_1: "☕️ 연락처 공유 안내",
      message_1:
        "회원님의 커피챗 요청에 대해 선배가 연락처를 공유했어요\n연락처를 확인하고 커피챗 일정을 잡아볼까요?",
      failover: "N",
    });
    expect(JSON.parse(button)).toEqual({
      button: [
        {
          name: "Cheers에서 확인하기",
          linkType: "WL",
          linkTypeName: "웹링크",
          linkMo: "https://cheers.example.com/applications/request-pk",
          linkPc: "https://cheers.example.com/applications/request-pk",
        },
      ],
    });
    expect(result).toEqual({ success: true, messageId: "123456789" });
  });

  it("uses the template of the event", async () => {
    fetchMock.mockResolvedValue(jsonResponse(successBody));
    const service = createService(config);

    await service.send({
      event: "coffee_chat_requested",
      to: "01012345678",
      variables: { recipientName: "김현업", coffeeChatRequestPk: "request-pk" },
    });

    const params = sentParams();
    expect(params.tpl_code).toBe("TPL-REQUESTED");
    expect(params.subject_1).toBe("☕️ 커피챗 요청 안내");
    expect(params.emtitle_1).toBe("☕️ 커피챗 요청 안내");
    expect(params.message_1).toBe(
      "재학생 회원으로부터 새로운 커피챗 요청이 도착했어요\n요청 내용을 확인하고 커피챗 가능 여부를 알려주세요 :)",
    );
    const { button } = JSON.parse(params.button_1);
    expect(button[0].name).toBe("Cheers에서 확인하기");
    expect(button[0].linkMo).toBe(
      "https://cheers.example.com/applications/request-pk?type=graduated",
    );
    expect(button[0].linkPc).toBe(
      "https://cheers.example.com/applications/request-pk?type=graduated",
    );
  });

  it("removes the trailing slash of WEB_BASE_URL from the button link", async () => {
    fetchMock.mockResolvedValue(jsonResponse(successBody));
    const service = createService({
      ...config,
      WEB_BASE_URL: "https://cheers.example.com/",
    });

    await service.send(input);

    const { button } = JSON.parse(sentParams().button_1);
    expect(button[0].linkMo).toBe(
      "https://cheers.example.com/applications/request-pk",
    );
  });

  it("keeps a message id sent as a string", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: 0, info: { mid: "987", fcnt: 0 } }),
    );
    const service = createService(config);

    await expect(service.send(input)).resolves.toEqual({
      success: true,
      messageId: "987",
    });
  });

  it("returns failure when aligo answers 200 with a non-zero code", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: -99, message: "포인트가 부족합니다." }),
    );
    const service = createService(config);

    await expect(service.send(input)).resolves.toEqual({
      success: false,
      error: "-99 포인트가 부족합니다.",
    });
  });

  it("returns failure when the receiver is rejected", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        code: 0,
        message: "성공적으로 전송요청 하였습니다.",
        info: { mid: 123456789, scnt: 0, fcnt: 1 },
      }),
    );
    const service = createService(config);

    await expect(service.send(input)).resolves.toEqual({
      success: false,
      messageId: "123456789",
      error: "0 invalid receiver: 성공적으로 전송요청 하였습니다.",
    });
  });

  it("returns failure on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: -101, message: "인증오류입니다." }, false, 401),
    );
    const service = createService(config);

    await expect(service.send(input)).resolves.toEqual({
      success: false,
      error: "401 -101 인증오류입니다.",
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

  it("skips sending when WEB_BASE_URL is not set", async () => {
    const service = createService({ ...config, WEB_BASE_URL: undefined });

    await expect(service.send(input)).resolves.toEqual({
      success: true,
      skipped: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips sending when WEB_BASE_URL is not https", async () => {
    const service = createService({
      ...config,
      WEB_BASE_URL: "http://cheers.example.com",
    });

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

  it("uses the template stored in the database", async () => {
    templateCache.get.mockResolvedValue({
      ...templates.contact_shared,
      tplCode: "TPL-EDITED",
      title: "바뀐 제목",
      message: "바뀐 본문",
      buttonName: "바뀐 버튼",
    });
    fetchMock.mockResolvedValue(jsonResponse(successBody));
    const service = createService(config);

    await service.send(input);

    const params = sentParams();
    expect(params.tpl_code).toBe("TPL-EDITED");
    expect(params.emtitle_1).toBe("바뀐 제목");
    expect(params.subject_1).toBe("바뀐 제목");
    expect(params.message_1).toBe("바뀐 본문");
    expect(JSON.parse(params.button_1).button[0].name).toBe("바뀐 버튼");
  });

  it("returns failure without calling aligo when the template is missing", async () => {
    templateCache.get.mockResolvedValue(null);
    const service = createService(config);

    const result = await service.send(input);

    expect(result).toEqual({ success: false, error: "template not found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips when the template code is empty", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    const log = jest.spyOn(Logger.prototype, "log").mockImplementation();
    templateCache.get.mockResolvedValue({
      ...templates.contact_shared,
      tplCode: "",
    });
    const service = createService(config);

    const result = await service.send(input);

    expect(result).toEqual({ success: true, skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
    warn.mockRestore();
    log.mockRestore();
  });

  describe("fetchBalance", () => {
    const heartBody = {
      code: 0,
      message: "성공",
      list: { CASH: "12,500", ALT_CNT: "340", SMS_CNT: 20, NOTE: "text" },
    };

    it("queries heartinfo and reads the amount and counts", async () => {
      fetchMock.mockResolvedValue(jsonResponse(heartBody));
      const service = createService(config);

      const result = await service.fetchBalance();

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://kakaoapi.aligo.in/akv10/heartinfo/");
      expect(init.method).toBe("POST");
      expect(sentParams()).toEqual({ apikey: "api-key", userid: "user-id" });
      expect(result).toEqual({
        status: "ok",
        amount: 12500,
        counts: { alt_cnt: 340, sms_cnt: 20 },
      });
    });

    it("returns amount null when no amount field is found", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ code: 0, list: { ALT_CNT: 1 } }),
      );
      const service = createService(config);

      expect(await service.fetchBalance()).toEqual({
        status: "ok",
        amount: null,
        counts: { alt_cnt: 1 },
      });
    });

    it("returns not_configured without calling aligo when config is not set", async () => {
      const service = createService({});

      expect(await service.fetchBalance()).toEqual({
        status: "not_configured",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns error when aligo answers 200 with a non-zero code", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ code: -101, message: "인증오류입니다." }),
      );
      const service = createService(config);

      expect(await service.fetchBalance()).toEqual({
        status: "error",
        error: "-101 인증오류입니다.",
      });
    });

    it("returns error on http failure, invalid body and network error", async () => {
      const service = createService(config);

      fetchMock.mockResolvedValueOnce(textResponse("<html>", false, 502));
      expect(await service.fetchBalance()).toEqual({
        status: "error",
        error: "502",
      });

      fetchMock.mockResolvedValueOnce(textResponse("<html>"));
      expect(await service.fetchBalance()).toEqual({
        status: "error",
        error: "200 invalid response body",
      });

      fetchMock.mockRejectedValueOnce(new Error("timeout"));
      expect(await service.fetchBalance()).toEqual({
        status: "error",
        error: "timeout",
      });
    });
  });

  describe("fetchResult", () => {
    // 알리고 문서의 전송결과조회(상세) 응답 예시 형식 (숫자도 문자열로 옴)
    const detailBody = (item: Record<string, unknown>) => ({
      code: 0,
      message: "정상적으로 호출하였습니다.",
      list: [
        {
          msgid: "123456788",
          type: "AT",
          sender: "0212345678",
          phone: "01012345678",
          status: "3",
          reqdate: "2026-11-08 13:02:56",
          sentdate: "2026-11-08 13:02:57",
          rsltdate: "2026-11-08 13:03:00",
          reportdate: "2026-11-08 13:03:01",
          rslt: "0",
          rslt_message: "성공",
          tpl_code: "TPL-SHARED",
          smid: "0",
          ...item,
        },
      ],
      currentPage: "1",
      totalPage: "1",
      totalCount: "1",
    });

    it("queries the history detail of the mid", async () => {
      fetchMock.mockResolvedValue(jsonResponse(detailBody({})));
      const service = createService(config);

      await service.fetchResult("123456788");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://kakaoapi.aligo.in/akv10/history/detail/");
      expect(init.method).toBe("POST");
      expect(sentParams()).toEqual({
        apikey: "api-key",
        userid: "user-id",
        mid: "123456788",
      });
    });

    it("returns delivered when rslt is 0, with rsltdate as KST", async () => {
      fetchMock.mockResolvedValue(jsonResponse(detailBody({})));
      const service = createService(config);

      await expect(service.fetchResult("123456788")).resolves.toEqual({
        status: "delivered",
        code: "0",
        message: "성공",
        reportedAt: new Date("2026-11-08T04:03:00.000Z"),
      });
    });

    it("accepts rslt sent as a number", async () => {
      fetchMock.mockResolvedValue(jsonResponse(detailBody({ rslt: 0 })));
      const service = createService(config);

      await expect(service.fetchResult("1")).resolves.toMatchObject({
        status: "delivered",
        code: "0",
      });
    });

    it("returns failed with the kakao code and reason", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          detailBody({
            rslt: "U",
            rslt_message: "메시지가 템플릿과 일치하지않음",
          }),
        ),
      );
      const service = createService(config);

      await expect(service.fetchResult("123456788")).resolves.toEqual({
        status: "failed",
        code: "U",
        message: "메시지가 템플릿과 일치하지않음",
        reportedAt: new Date("2026-11-08T04:03:00.000Z"),
      });
    });

    it("keeps a failure without reason or result time", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(detailBody({ rslt: "K", rslt_message: "", rsltdate: "" })),
      );
      const service = createService(config);

      await expect(service.fetchResult("1")).resolves.toEqual({
        status: "failed",
        code: "K",
        message: null,
        reportedAt: null,
      });
    });

    it("returns pending while the message is still being sent (msgid starts with Q)", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          detailBody({ msgid: "Q123456788", rslt: "", rsltdate: "" }),
        ),
      );
      const service = createService(config);

      await expect(service.fetchResult("1")).resolves.toEqual({
        status: "pending",
      });
    });

    it("returns pending when rslt is not set yet", async () => {
      fetchMock.mockResolvedValue(jsonResponse(detailBody({ rslt: "" })));
      const service = createService(config);

      await expect(service.fetchResult("1")).resolves.toEqual({
        status: "pending",
      });
    });

    it("returns pending when the mid is not in the list yet", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          code: 0,
          message: "정상적으로 호출하였습니다.",
          list: [],
        }),
      );
      const service = createService(config);

      await expect(service.fetchResult("1")).resolves.toEqual({
        status: "pending",
      });
    });

    it("returns error when aligo answers 200 with a non-zero code", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ code: -101, message: "인증오류입니다." }),
      );
      const service = createService(config);

      await expect(service.fetchResult("1")).resolves.toEqual({
        status: "error",
        error: "-101 인증오류입니다.",
      });
    });

    it("returns error on a non-2xx response that is not json", async () => {
      fetchMock.mockResolvedValue(textResponse("<html>502</html>", false, 502));
      const service = createService(config);

      await expect(service.fetchResult("1")).resolves.toEqual({
        status: "error",
        error: "502",
      });
    });

    it("returns error when a 2xx body is not json", async () => {
      fetchMock.mockResolvedValue(textResponse("<html></html>"));
      const service = createService(config);

      await expect(service.fetchResult("1")).resolves.toEqual({
        status: "error",
        error: "200 invalid response body",
      });
    });

    it("returns error instead of throwing when the request fails", async () => {
      fetchMock.mockRejectedValue(
        new Error("The operation was aborted due to timeout"),
      );
      const service = createService(config);

      await expect(service.fetchResult("1")).resolves.toEqual({
        status: "error",
        error: "The operation was aborted due to timeout",
      });
    });

    it("does not call aligo when config is not set", async () => {
      const service = createService({});

      await expect(service.fetchResult("1")).resolves.toEqual({
        status: "error",
        error: "alimtalk is not configured",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
