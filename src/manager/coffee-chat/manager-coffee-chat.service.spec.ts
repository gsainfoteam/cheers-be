import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { AdminCoffeeChatRequestRepository } from "@src/admin-repository/admin-coffee-chat-request.repository";
import { AdminAuditLogRepository } from "@src/admin-repository/admin-audit-log.repository";
import { AdminNotificationLogRepository } from "@src/admin-repository/admin-notification-log.repository";
import { DatabaseService } from "@src/database/database.service";
import { TxType } from "@src/global/types/tx.types";
import { ManagerContext } from "@src/manager/context/manager-context";
import { ManagerCoffeeChatService } from "@src/manager/coffee-chat/manager-coffee-chat.service";
import { NotificationDeliverySyncService } from "@src/notification/notification-delivery-sync.service";

const NOW = new Date("2026-10-31T00:00:00Z");
const requestRow = (overrides: object = {}) => ({
  pk: "request",
  message: "질문 있습니다",
  createdAt: NOW,
  graduatedViewedAt: null,
  contactSharedAt: null,
  studentViewedAt: null,
  student: { pk: "s", name: "김재학", department: "전자전기", active: true },
  graduated: {
    pk: "g",
    nickname: "현업",
    company: "인포테크",
    job: "백엔드",
    active: true,
  },
  ...overrides,
});
const logRow = (overrides: object = {}) => ({
  pk: "log",
  coffeeChatRequestPk: "request",
  event: "contact_shared",
  channel: "kakao_alimtalk",
  status: "failed",
  createdAt: NOW,
  providerMessageId: "mid",
  recipient: "01012345678",
  error: "-99 invalid receiver 01012345678",
  attempt: 2,
  nextRetryAt: new Date(NOW.getTime() + 5 * 60 * 1000),
  deliveryStatus: null,
  deliveryCode: null,
  deliveryMessage: null,
  deliveryReportedAt: null,
  deliveryNextCheckAt: null,
  ...overrides,
});

describe("ManagerCoffeeChatService", () => {
  const requests = { findPage: jest.fn(), findByPk: jest.fn() };
  const logs = {
    findPage: jest.fn(),
    findByRequestPk: jest.fn(),
    findByPk: jest.fn(),
  };
  const deliverySync = { refresh: jest.fn() };
  const tx = {} as TxType;
  const dbService = {
    db: { transaction: (fn: (tx: TxType) => unknown) => fn(tx) },
  };
  const auditLogs = { insert: jest.fn() };
  const manager = new ManagerContext("me", "me@gm.gist.ac.kr", "admin");
  const service = new ManagerCoffeeChatService(
    requests as unknown as AdminCoffeeChatRequestRepository,
    logs as unknown as AdminNotificationLogRepository,
    deliverySync as unknown as NotificationDeliverySyncService,
    dbService as unknown as DatabaseService,
    auditLogs as unknown as AdminAuditLogRepository,
  );

  beforeEach(() => jest.resetAllMocks());

  describe("listRequests", () => {
    it("필터를 넘기고 시각 컬럼으로 상태를 계산", async () => {
      requests.findPage.mockResolvedValue({
        rows: [
          requestRow({ pk: "a" }),
          requestRow({ pk: "b", graduatedViewedAt: NOW }),
          requestRow({ pk: "c", graduatedViewedAt: NOW, contactSharedAt: NOW }),
          // 열람 시각 없이 공유만 있어도 공유로 봄
          requestRow({ pk: "d", contactSharedAt: NOW }),
        ],
        total: 34,
      });

      const res = await service.listRequests({
        page: 2,
        size: 10,
        status: "viewed",
        created_from: "2026-10-01T00:00:00+09:00",
        created_to: "2026-11-01T00:00:00+09:00",
        student_pk: "s",
        student_name: "김",
        graduated_pk: "g",
        graduated_nickname: "현",
      });

      expect(requests.findPage).toHaveBeenCalledWith(
        {
          status: "viewed",
          createdFrom: new Date("2026-09-30T15:00:00Z"),
          createdTo: new Date("2026-10-31T15:00:00Z"),
          studentPk: "s",
          studentName: "김",
          graduatedPk: "g",
          graduatedNickname: "현",
        },
        10,
        10,
      );
      expect(res).toMatchObject({ page: 2, size: 10, total: 34 });
      expect(res.items.map((item) => item.status)).toEqual([
        "requested",
        "viewed",
        "contact_shared",
        "contact_shared",
      ]);
    });

    it("목록에는 메시지를 넣지 않음", async () => {
      requests.findPage.mockResolvedValue({ rows: [requestRow()], total: 1 });

      const res = await service.listRequests({ page: 1, size: 20 });

      expect(res.items[0]).not.toHaveProperty("message");
    });

    it("시작이 끝보다 늦으면 400", async () => {
      await expect(
        service.listRequests({
          page: 1,
          size: 20,
          created_from: "2026-11-01T00:00:00Z",
          created_to: "2026-10-01T00:00:00Z",
        }),
      ).rejects.toThrow(BadRequestException);
      expect(requests.findPage).not.toHaveBeenCalled();
    });
  });

  describe("getRequest", () => {
    it("없는 요청은 404", async () => {
      requests.findByPk.mockResolvedValue(null);

      await expect(service.getRequest("x")).rejects.toThrow(NotFoundException);
      expect(logs.findByRequestPk).not.toHaveBeenCalled();
    });

    it("메시지 · 시각과 발송 결과를 내려주고 수신자는 뺌", async () => {
      requests.findByPk.mockResolvedValue(
        requestRow({ contactSharedAt: NOW, studentViewedAt: NOW }),
      );
      logs.findByRequestPk.mockResolvedValue([logRow()]);

      const res = await service.getRequest("request");

      expect(res).toMatchObject({
        status: "contact_shared",
        message: "질문 있습니다",
        contact_shared_at: NOW,
        student_viewed_at: NOW,
      });
      expect(res.notifications).toEqual([
        {
          pk: "log",
          event: "contact_shared",
          channel: "kakao_alimtalk",
          status: "failed",
          error: "-99 invalid receiver 010****5678",
          provider_message_id: "mid",
          delivery_status: null,
          delivery_code: null,
          delivery_message: null,
          delivery_reported_at: null,
          attempt: 2,
          next_retry_at: new Date(NOW.getTime() + 5 * 60 * 1000),
          created_at: NOW,
        },
      ]);
    });
  });

  describe("listNotificationLogs", () => {
    it("필터를 넘기고 수신자는 빼고 실패 사유는 가림", async () => {
      logs.findPage.mockResolvedValue({
        rows: [
          logRow(),
          logRow({
            pk: "ok",
            channel: "email",
            status: "sent",
            recipient: "someone@example.com",
            error: null,
            attempt: 1,
            nextRetryAt: null,
          }),
        ],
        total: 2,
      });

      const res = await service.listNotificationLogs({
        page: 1,
        size: 20,
        channel: "kakao_alimtalk",
        status: "failed",
        event: "contact_shared",
      });

      expect(logs.findPage).toHaveBeenCalledWith(
        {
          channel: "kakao_alimtalk",
          status: "failed",
          event: "contact_shared",
          createdFrom: undefined,
          createdTo: undefined,
        },
        0,
        20,
      );
      expect(res.items[0]).toMatchObject({
        coffee_chat_request_pk: "request",
        error: "-99 invalid receiver 010****5678",
        attempt: 2,
        next_retry_at: new Date(NOW.getTime() + 5 * 60 * 1000),
      });
      expect(res.items[1]).toMatchObject({
        error: null,
        attempt: 1,
        next_retry_at: null,
      });
      expect(JSON.stringify(res)).not.toContain("01012345678");
      expect(JSON.stringify(res)).not.toContain("someone@example.com");
      expect(res.items[0]).not.toHaveProperty("recipient");
    });

    it("알림톡 mid와 카카오 최종 결과를 내려주고 실패 사유의 전화번호는 가림 (CRB-77)", async () => {
      logs.findPage.mockResolvedValue({
        rows: [
          logRow({
            status: "sent",
            error: null,
            attempt: 1,
            nextRetryAt: null,
            providerMessageId: "123456788",
            deliveryStatus: "failed",
            deliveryCode: "U",
            deliveryMessage: "메시지가 템플릿과 일치하지않음 01012345678",
            deliveryReportedAt: NOW,
          }),
        ],
        total: 1,
      });

      const res = await service.listNotificationLogs({
        page: 1,
        size: 20,
        delivery_status: "failed",
      });

      expect(logs.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryStatus: "failed" }),
        0,
        20,
      );
      expect(res.items[0]).toMatchObject({
        status: "sent",
        provider_message_id: "123456788",
        delivery_status: "failed",
        delivery_code: "U",
        delivery_message: "메시지가 템플릿과 일치하지않음 010****5678",
        delivery_reported_at: NOW,
      });
      expect(res.items[0]).not.toHaveProperty("delivery_next_check_at");
    });
  });

  describe("lookupDelivery (CRB-77)", () => {
    const accepted = (overrides: object = {}) =>
      logRow({
        status: "sent",
        error: null,
        attempt: 1,
        nextRetryAt: null,
        providerMessageId: "123456788",
        deliveryStatus: "pending",
        ...overrides,
      });

    it("알리고에 mid로 조회하고 저장된 결과를 내려줌", async () => {
      logs.findByPk.mockResolvedValueOnce(accepted()).mockResolvedValueOnce(
        accepted({
          deliveryStatus: "failed",
          deliveryCode: "U",
          deliveryMessage: "메시지가 템플릿과 일치하지않음 01012345678",
        }),
      );
      deliverySync.refresh.mockResolvedValue({
        status: "failed",
        code: "U",
        message: "메시지가 템플릿과 일치하지않음 01012345678",
        reportedAt: null,
      });

      const res = await service.lookupDelivery("log", manager);

      expect(deliverySync.refresh).toHaveBeenCalledWith("log", "123456788");
      expect(res.lookup).toBe("failed");
      expect(res.log).toMatchObject({
        pk: "log",
        coffee_chat_request_pk: "request",
        provider_message_id: "123456788",
        delivery_status: "failed",
        delivery_code: "U",
        delivery_message: "메시지가 템플릿과 일치하지않음 010****5678",
      });
      expect(res.log).not.toHaveProperty("recipient");
      expect(auditLogs.insert).toHaveBeenCalledWith(
        {
          adminEmail: "me@gm.gist.ac.kr",
          action: "notification_log.delivery_lookup",
          targetType: "notification_log",
          targetId: "log",
          before: {
            delivery_status: "pending",
            delivery_code: null,
            delivery_message: null,
            delivery_reported_at: null,
          },
          after: {
            delivery_status: "failed",
            delivery_code: "U",
            delivery_message: "메시지가 템플릿과 일치하지않음 010****5678",
            delivery_reported_at: null,
          },
        },
        tx,
      );
    });

    it("아직 전송 중이면 pending과 그대로인 로그", async () => {
      logs.findByPk.mockResolvedValue(accepted());
      deliverySync.refresh.mockResolvedValue({ status: "pending" });

      const res = await service.lookupDelivery("log", manager);

      expect(res.lookup).toBe("pending");
      expect(res.log.delivery_status).toBe("pending");
      // 저장된 값이 그대로면 감사 로그를 남기지 않음
      expect(auditLogs.insert).not.toHaveBeenCalled();
    });

    it("알리고 조회가 실패하면 502, 사유의 전화번호는 가림", async () => {
      logs.findByPk.mockResolvedValue(accepted());
      deliverySync.refresh.mockResolvedValue({
        status: "error",
        error: "-101 인증오류입니다. 01012345678",
      });

      const error = await service
        .lookupDelivery("log", manager)
        .catch((e) => e);

      expect(error).toBeInstanceOf(BadGatewayException);
      expect(auditLogs.insert).not.toHaveBeenCalled();
      expect(error.message).toBe(
        "Failed to fetch the result from Aligo: -101 인증오류입니다. 010****5678",
      );
    });

    it("없는 로그는 404", async () => {
      logs.findByPk.mockResolvedValue(null);

      await expect(
        service.lookupDelivery("log", manager),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([
      ["이메일", { channel: "email" }],
      ["접수 실패한 알림톡", { status: "failed" }],
      ["mid가 없는 알림톡", { providerMessageId: null }],
    ])("%s은 400이고 알리고를 부르지 않음", async (_, overrides) => {
      logs.findByPk.mockResolvedValue(accepted(overrides));

      await expect(
        service.lookupDelivery("log", manager),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(deliverySync.refresh).not.toHaveBeenCalled();
    });
  });
});
