import {
  ConflictException,
  GoneException,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "@src/database/database.service";
import { CoffeeChatContactRepository } from "@src/database/repository/coffee-chat-contact.repository";
import {
  CoffeeChatRequestRepository,
  ReceivedRequestDetailRow,
  ReceivedRequestForShareRow,
  ReceivedRequestRow,
  StudentContact,
} from "@src/database/repository/coffee-chat-request.repository";
import { UserRepository } from "@src/database/repository/user.repository";
import { FileService } from "@src/file/file.service";
import { TxType } from "@src/global/types/tx.types";
import { NotificationService } from "@src/notification/notification.service";
import { NotifyInput } from "@src/notification/notification.types";
import { CheersGraduatedService } from "./cheers-graduated.service";
import { PaginationQueryDto } from "./dto/pagination.dto";

const userPk = "8f1d2c3b-0000-4000-8000-000000000001";
const requestPk = "c0ffee00-1234-4abc-8def-001122334455";
const createdAt = new Date("2026-10-25T12:00:00.000Z");
const viewedAt = new Date("2026-10-25T13:00:00.000Z");
const sharedAt = new Date("2026-10-25T13:30:00.000Z");

const studentContact = (
  overrides: Partial<StudentContact> = {},
): StudentContact => ({
  kakaoEnabled: true,
  emailEnabled: true,
  phone: "01011112222",
  email: "gildong@gm.gist.ac.kr",
  ...overrides,
});

const myContact = (overrides = {}) => ({
  userPk,
  kakaoEnabled: true,
  emailEnabled: true,
  createdAt,
  updatedAt: createdAt,
  phone: "01000000000",
  email: "chulsoo@example.com",
  ...overrides,
});

const listRow = (
  overrides: Partial<ReceivedRequestRow> = {},
): ReceivedRequestRow => ({
  pk: requestPk,
  createdAt,
  graduatedViewedAt: null,
  contactSharedAt: null,
  studentName: "홍길동",
  studentActive: true,
  departmentName: "전기전자컴퓨터공학부",
  ...overrides,
});

const detailRow = (
  overrides: Partial<ReceivedRequestDetailRow> = {},
): ReceivedRequestDetailRow => ({
  ...listRow(),
  message: "궁금합니다",
  interests: ["반도체"],
  activities: null,
  attachments: [],
  studentContact: studentContact(),
  ...overrides,
});

const shareRow = (
  overrides: Partial<ReceivedRequestForShareRow> = {},
): ReceivedRequestForShareRow => ({
  pk: requestPk,
  contactSharedAt: null,
  sharedEmail: null,
  sharedPhone: null,
  studentName: "홍길동",
  studentActive: true,
  studentContact: studentContact(),
  ...overrides,
});

describe("CheersGraduatedService", () => {
  const tx = {} as TxType;
  // 트랜잭션 콜백이 끝났는지 기록해 알림 · 서명이 커밋 뒤에 일어나는지 확인
  const events: string[] = [];
  const dbService = {
    db: {
      transaction: async (fn: (tx: TxType) => unknown) => {
        const result = await fn(tx);
        events.push("commit");
        return result;
      },
    },
  };
  const coffeeChatRequestRepository = {
    findReceivedPage: jest.fn(),
    findReceivedByPk: jest.fn(),
    findReceivedForShare: jest.fn(),
    markGraduatedViewed: jest.fn(),
    markContactShared: jest.fn(),
  };
  const coffeeChatContactRepository = { findByUserPk: jest.fn() };
  const userRepository = { findByPk: jest.fn() };
  const fileService = { getPresignedUrl: jest.fn() };
  const notificationService = {
    notifyAsync: jest.fn((_input: NotifyInput<"contact_shared">) => {
      events.push("notify");
    }),
  };
  const lastNotified = () => {
    const call = notificationService.notifyAsync.mock.lastCall;
    if (!call) throw new Error("notifyAsync was not called");
    return call[0];
  };

  const createService = (env: Record<string, string | undefined> = {}) =>
    new CheersGraduatedService(
      {
        get: (key: string) =>
          ({ WEB_BASE_URL: "https://cheers.example.com/", ...env })[key],
      } as unknown as ConfigService,
      dbService as unknown as DatabaseService,
      coffeeChatRequestRepository as unknown as CoffeeChatRequestRepository,
      coffeeChatContactRepository as unknown as CoffeeChatContactRepository,
      userRepository as unknown as UserRepository,
      fileService as unknown as FileService,
      notificationService as unknown as NotificationService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    events.length = 0;
    coffeeChatContactRepository.findByUserPk.mockResolvedValue(myContact());
    userRepository.findByPk.mockResolvedValue({ name: "김철수" });
    coffeeChatRequestRepository.markContactShared.mockResolvedValue(sharedAt);
  });

  describe("constructor", () => {
    it("requires WEB_BASE_URL in production", () => {
      expect(() =>
        createService({ WEB_BASE_URL: "", NODE_ENV: "production" }),
      ).toThrow("WEB_BASE_URL is required in production.");
    });
  });

  describe("getReceivedList", () => {
    const query = Object.assign(new PaginationQueryDto(), {
      page: 3,
      size: 10,
    });

    it("maps rows and pages", async () => {
      coffeeChatRequestRepository.findReceivedPage.mockResolvedValue({
        rows: [
          listRow(),
          listRow({ graduatedViewedAt: viewedAt }),
          listRow({ graduatedViewedAt: viewedAt, contactSharedAt: sharedAt }),
        ],
        total: 23,
      });

      const result = await createService().getReceivedList(userPk, query);

      expect(coffeeChatRequestRepository.findReceivedPage).toHaveBeenCalledWith(
        userPk,
        20,
        10,
      );
      expect(result).toMatchObject({ page: 3, size: 10, total: 23 });
      expect(result.items.map((item) => item.status)).toEqual([
        "requested",
        "viewed",
        "contact_shared",
      ]);
      expect(result.items[0]).toEqual({
        id: requestPk,
        student_name: "홍길동",
        department: "전기전자컴퓨터공학부",
        student_withdrawn: false,
        status: "requested",
        created_at: createdAt.toISOString(),
      });
    });

    it.each([
      ["withdrawn", null],
      ["in the grace period", "홍길동"],
    ])("hides the name of a student %s", async (_, studentName) => {
      coffeeChatRequestRepository.findReceivedPage.mockResolvedValue({
        rows: [listRow({ studentActive: false, studentName })],
        total: 1,
      });

      const { items } = await createService().getReceivedList(userPk, query);

      expect(items[0]).toMatchObject({
        student_name: "탈퇴한 학생의 신청서입니다",
        department: "전기전자컴퓨터공학부",
        student_withdrawn: true,
      });
    });
  });

  describe("getReceivedDetail", () => {
    it("throws 404 for a missing or someone else's request", async () => {
      coffeeChatRequestRepository.findReceivedByPk.mockResolvedValue(null);

      await expect(
        createService().getReceivedDetail(userPk, requestPk),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws 410 without recording the view when the student left", async () => {
      coffeeChatRequestRepository.findReceivedByPk.mockResolvedValue(
        detailRow({ studentActive: false }),
      );

      await expect(
        createService().getReceivedDetail(userPk, requestPk),
      ).rejects.toThrow(GoneException);
      expect(
        coffeeChatRequestRepository.markGraduatedViewed,
      ).not.toHaveBeenCalled();
    });

    it("records the first view and answers viewed", async () => {
      coffeeChatRequestRepository.findReceivedByPk.mockResolvedValue(
        detailRow(),
      );

      const result = await createService().getReceivedDetail(userPk, requestPk);

      expect(coffeeChatRequestRepository.findReceivedByPk).toHaveBeenCalledWith(
        requestPk,
        userPk,
        tx,
      );
      expect(
        coffeeChatRequestRepository.markGraduatedViewed,
      ).toHaveBeenCalledWith(requestPk, tx);
      expect(result).toEqual({
        id: requestPk,
        message: "궁금합니다",
        status: "viewed",
        created_at: createdAt.toISOString(),
        contact_shared_at: null,
        student: {
          name: "홍길동",
          department: "전기전자컴퓨터공학부",
          interests: ["반도체"],
          activities: [],
          attachments: [],
          email: "gildong@gm.gist.ac.kr",
          phone: "01011112222",
        },
      });
    });

    it("does not overwrite an earlier view", async () => {
      coffeeChatRequestRepository.findReceivedByPk.mockResolvedValue(
        detailRow({ graduatedViewedAt: viewedAt, contactSharedAt: sharedAt }),
      );

      const result = await createService().getReceivedDetail(userPk, requestPk);

      expect(
        coffeeChatRequestRepository.markGraduatedViewed,
      ).not.toHaveBeenCalled();
      expect(result.status).toBe("contact_shared");
      expect(result.contact_shared_at).toBe(sharedAt.toISOString());
    });

    it.each([
      [{ emailEnabled: false }, null, "01011112222"],
      [{ kakaoEnabled: false }, "gildong@gm.gist.ac.kr", null],
    ])(
      "shows only the channels the student chose (%j)",
      async (overrides, email, phone) => {
        coffeeChatRequestRepository.findReceivedByPk.mockResolvedValue(
          detailRow({ studentContact: studentContact(overrides) }),
        );

        const { student } = await createService().getReceivedDetail(
          userPk,
          requestPk,
        );

        expect(student).toMatchObject({ email, phone });
      },
    );

    it("presigns only file attachments, after the commit", async () => {
      coffeeChatRequestRepository.findReceivedByPk.mockResolvedValue(
        detailRow({
          attachments: [
            {
              kind: "cv",
              source: "file",
              url: "attachment/key.pdf",
              fileName: "cv.pdf",
            },
            {
              kind: "portfolio",
              source: "link",
              url: "https://portfolio.example.com",
              fileName: null,
            },
          ],
        }),
      );
      fileService.getPresignedUrl.mockImplementation(async () => {
        events.push("presign");
        return "https://s3.example.com/signed";
      });

      const { student } = await createService().getReceivedDetail(
        userPk,
        requestPk,
      );

      expect(fileService.getPresignedUrl).toHaveBeenCalledTimes(1);
      expect(fileService.getPresignedUrl).toHaveBeenCalledWith(
        "attachment/key.pdf",
      );
      expect(events).toEqual(["commit", "presign"]);
      expect(student.attachments).toEqual([
        {
          kind: "cv",
          source: "file",
          url: "https://s3.example.com/signed",
          file_name: "cv.pdf",
        },
        {
          kind: "portfolio",
          source: "link",
          url: "https://portfolio.example.com",
          file_name: null,
        },
      ]);
    });
  });

  describe("shareContact", () => {
    const expectNothingShared = () => {
      expect(
        coffeeChatRequestRepository.markContactShared,
      ).not.toHaveBeenCalled();
      expect(notificationService.notifyAsync).not.toHaveBeenCalled();
    };

    it("throws 404 for a missing or someone else's request", async () => {
      coffeeChatRequestRepository.findReceivedForShare.mockResolvedValue(null);

      await expect(
        createService().shareContact(userPk, requestPk),
      ).rejects.toThrow(NotFoundException);
      expectNothingShared();
    });

    it("throws 404 before 409 when I have no contact", async () => {
      coffeeChatRequestRepository.findReceivedForShare.mockResolvedValue(null);
      coffeeChatContactRepository.findByUserPk.mockResolvedValue(null);

      await expect(
        createService().shareContact(userPk, requestPk),
      ).rejects.toThrow(NotFoundException);
    });

    it.each([
      ["active", true],
      ["withdrawn", false],
    ])(
      "returns the first result without notifying when already shared (%s student)",
      async (_, studentActive) => {
        coffeeChatRequestRepository.findReceivedForShare.mockResolvedValue(
          shareRow({
            contactSharedAt: sharedAt,
            sharedEmail: "old@example.com",
            sharedPhone: null,
            studentActive,
          }),
        );

        const result = await createService().shareContact(userPk, requestPk);

        expect(result).toEqual({
          contact_shared_at: sharedAt.toISOString(),
          shared_email: "old@example.com",
          shared_phone: null,
        });
        expectNothingShared();
      },
    );

    it("returns the first result even if I turned my contact off since", async () => {
      coffeeChatRequestRepository.findReceivedForShare.mockResolvedValue(
        shareRow({ contactSharedAt: sharedAt, sharedEmail: "old@example.com" }),
      );
      coffeeChatContactRepository.findByUserPk.mockResolvedValue(
        myContact({ emailEnabled: false, kakaoEnabled: false }),
      );

      const result = await createService().shareContact(userPk, requestPk);

      expect(result.shared_email).toBe("old@example.com");
    });

    it("throws 410 on a first share to a student who left", async () => {
      coffeeChatRequestRepository.findReceivedForShare.mockResolvedValue(
        shareRow({ studentActive: false }),
      );

      await expect(
        createService().shareContact(userPk, requestPk),
      ).rejects.toThrow(GoneException);
      expectNothingShared();
    });

    it.each([
      ["no contact row", null],
      [
        "both channels off",
        myContact({ emailEnabled: false, kakaoEnabled: false }),
      ],
    ])("throws 409 with %s", async (_, contact) => {
      coffeeChatRequestRepository.findReceivedForShare.mockResolvedValue(
        shareRow(),
      );
      coffeeChatContactRepository.findByUserPk.mockResolvedValue(contact);

      await expect(
        createService().shareContact(userPk, requestPk),
      ).rejects.toThrow(ConflictException);
      expectNothingShared();
    });

    it("saves only the channels I chose", async () => {
      coffeeChatRequestRepository.findReceivedForShare.mockResolvedValue(
        shareRow(),
      );
      coffeeChatContactRepository.findByUserPk.mockResolvedValue(
        myContact({ kakaoEnabled: false }),
      );

      const result = await createService().shareContact(userPk, requestPk);

      expect(
        coffeeChatRequestRepository.markContactShared,
      ).toHaveBeenCalledWith(
        requestPk,
        { sharedEmail: "chulsoo@example.com", sharedPhone: null },
        tx,
      );
      expect(result).toEqual({
        contact_shared_at: sharedAt.toISOString(),
        shared_email: "chulsoo@example.com",
        shared_phone: null,
      });
    });

    it("notifies the student's channels after the commit", async () => {
      coffeeChatRequestRepository.findReceivedForShare.mockResolvedValue(
        shareRow(),
      );

      await createService().shareContact(userPk, requestPk);

      expect(events).toEqual(["commit", "notify"]);
      const notified = lastNotified();
      expect(notified).toMatchObject({
        coffeeChatRequestPk: requestPk,
        event: "contact_shared",
        email: { to: "gildong@gm.gist.ac.kr" },
        alimtalk: {
          to: "01011112222",
          variables: {
            recipientName: "홍길동",
            graduatedName: "김철수",
            coffeeChatRequestPk: requestPk,
          },
        },
      });
      expect(notified.email?.text).toContain(
        `https://cheers.example.com/cheers/sent/${requestPk}`,
      );
      // 연락처 자체는 알림에 넣지 않음
      expect(notified.email?.text).not.toContain("chulsoo@example.com");
    });

    it("sends only the channels the student chose", async () => {
      coffeeChatRequestRepository.findReceivedForShare.mockResolvedValue(
        shareRow({
          studentContact: studentContact({ emailEnabled: false }),
        }),
      );

      await createService().shareContact(userPk, requestPk);

      expect(lastNotified().email).toBeUndefined();
      expect(lastNotified().alimtalk?.to).toBe("01011112222");
    });

    it("sends the mail without a link when WEB_BASE_URL is not set", async () => {
      coffeeChatRequestRepository.findReceivedForShare.mockResolvedValue(
        shareRow(),
      );

      await createService({ WEB_BASE_URL: undefined }).shareContact(
        userPk,
        requestPk,
      );

      expect(lastNotified().email?.text).not.toContain("http");
    });

    it("falls back when names are missing", async () => {
      coffeeChatRequestRepository.findReceivedForShare.mockResolvedValue(
        shareRow({ studentName: null }),
      );
      userRepository.findByPk.mockResolvedValue({ name: null });

      await createService().shareContact(userPk, requestPk);

      expect(lastNotified().alimtalk?.variables).toMatchObject({
        recipientName: "재학생",
        graduatedName: "현업자",
      });
    });

    it("does not notify when the transaction fails", async () => {
      coffeeChatRequestRepository.findReceivedForShare.mockResolvedValue(
        shareRow(),
      );
      coffeeChatRequestRepository.markContactShared.mockRejectedValue(
        new Error("db down"),
      );

      await expect(
        createService().shareContact(userPk, requestPk),
      ).rejects.toThrow("db down");
      expect(notificationService.notifyAsync).not.toHaveBeenCalled();
    });
  });
});
