import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "@src/database/database.service";
import {
  CoffeeChatRequestRepository,
  SentRequestDetailRow,
  SentRequestRow,
} from "@src/database/repository/coffee-chat-request.repository";
import { CoffeeChatContactRow } from "@src/database/repository/coffee-chat-contact.repository";
import {
  GraduatedCardRepository,
  GraduatedCardRow,
  GraduatedRequestTarget,
} from "@src/database/repository/graduated-card.repository";
import { StudentRepository } from "@src/database/repository/student.repository";
import { TxType } from "@src/global/types/tx.types";
import { NotificationService } from "@src/notification/notification.service";
import { NotifyInput } from "@src/notification/notification.types";
import { CheersStudentService } from "./cheers-student.service";
import { GraduatedListQueryDto } from "./dto/graduated-list.dto";
import { PaginationQueryDto } from "./dto/pagination.dto";

const userPk = "8f1d2c3b-0000-4000-8000-000000000001";
const studentPk = "8f1d2c3b-0000-4000-8000-000000000002";
const profilePk = "8f1d2c3b-0000-4000-8000-000000000003";
const graduatedPk = "8f1d2c3b-0000-4000-8000-000000000004";
const requestPk = "c0ffee00-1234-4abc-8def-001122334455";
const createdAt = new Date("2026-10-25T12:00:00.000Z");

const contact = (
  overrides: Partial<CoffeeChatContactRow> = {},
): CoffeeChatContactRow => ({
  userPk: "graduated-user-pk",
  kakaoEnabled: true,
  emailEnabled: true,
  createdAt,
  updatedAt: createdAt,
  phone: "01000000000",
  email: "chulsoo@example.com",
  ...overrides,
});

const target = (
  overrides: Partial<GraduatedRequestTarget> = {},
): GraduatedRequestTarget => ({
  graduatedPk,
  name: "김철수",
  contact: contact(),
  ...overrides,
});

const sentRow = (overrides: Partial<SentRequestRow> = {}): SentRequestRow => ({
  pk: requestPk,
  message: "궁금합니다",
  createdAt,
  graduatedViewedAt: null,
  contactSharedAt: null,
  graduated: {
    graduatedPk,
    nickname: "철수",
    company: "인포테크",
    job: "백엔드 개발자",
  },
  graduatedActive: true,
  ...overrides,
});

const detailRow = (
  overrides: Partial<SentRequestDetailRow> = {},
): SentRequestDetailRow => ({
  ...sentRow(),
  studentViewedAt: null,
  sharedEmail: null,
  sharedPhone: null,
  graduatedName: "김철수",
  ...overrides,
});

const query = <T extends PaginationQueryDto>(
  dto: new () => T,
  values: Partial<T>,
): T => Object.assign(new dto(), values);

describe("CheersStudentService", () => {
  const tx = {} as TxType;
  // 트랜잭션 콜백이 끝났는지 기록해 알림이 커밋 뒤에 나가는지 확인
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
  const studentRepository = { findByUserPkWithLatestProfile: jest.fn() };
  const graduatedCardRepository = {
    findPage: jest.fn(),
    findRequestTarget: jest.fn(),
  };
  const coffeeChatRequestRepository = {
    insert: jest.fn(),
    findSentPage: jest.fn(),
    findSentByPk: jest.fn(),
    markStudentViewed: jest.fn(),
  };
  const notificationService = {
    notifyAsync: jest.fn((_input: NotifyInput<"coffee_chat_requested">) => {
      events.push("notify");
    }),
  };
  const lastNotified = () => {
    const call = notificationService.notifyAsync.mock.lastCall;
    if (!call) throw new Error("notifyAsync was not called");
    return call[0];
  };

  const createService = (env: Record<string, string | undefined> = {}) =>
    new CheersStudentService(
      {
        get: (key: string) =>
          ({ WEB_BASE_URL: "https://cheers.example.com/", ...env })[key],
      } as unknown as ConfigService,
      dbService as unknown as DatabaseService,
      studentRepository as unknown as StudentRepository,
      graduatedCardRepository as unknown as GraduatedCardRepository,
      coffeeChatRequestRepository as unknown as CoffeeChatRequestRepository,
      notificationService as unknown as NotificationService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    events.length = 0;
  });

  describe("constructor", () => {
    it("requires WEB_BASE_URL in production", () => {
      expect(() =>
        createService({ WEB_BASE_URL: "", NODE_ENV: "production" }),
      ).toThrow("WEB_BASE_URL is required in production.");
    });

    it.each(["0", "-1", "1.5", "abc"])(
      "rejects CHEERS_RANDOM_SEED_MINUTES=%s",
      (value) => {
        expect(() =>
          createService({ CHEERS_RANDOM_SEED_MINUTES: value }),
        ).toThrow("CHEERS_RANDOM_SEED_MINUTES must be a positive integer");
      },
    );
  });

  describe("getGraduatedList", () => {
    const card: GraduatedCardRow = {
      graduatedPk,
      nickname: "철수",
      company: "인포테크",
      job: "백엔드 개발자",
      hashtags: null,
      links: ["https://www.linkedin.com/in/chulsoo"],
      lastActiveAt: new Date("2026-10-24T09:12:33.000Z"),
      canRequest: false,
    };

    afterEach(() => jest.useRealTimers());

    it("maps cards and pages with the requested sort", async () => {
      graduatedCardRepository.findPage.mockResolvedValue({
        rows: [card],
        total: 41,
      });

      const result = await createService().getGraduatedList(
        query(GraduatedListQueryDto, {
          sort: "recent_active",
          page: 3,
          size: 20,
        }),
      );

      expect(graduatedCardRepository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({
          sort: "recent_active",
          offset: 40,
          limit: 20,
        }),
      );
      expect(result).toEqual({
        items: [
          {
            graduated_id: graduatedPk,
            nickname: "철수",
            company: "인포테크",
            job: "백엔드 개발자",
            hashtags: [],
            links: ["https://www.linkedin.com/in/chulsoo"],
            last_active_at: "2026-10-24T09:12:33.000Z",
            can_request: false,
          },
        ],
        page: 3,
        size: 20,
        total: 41,
      });
    });

    it("keeps the random seed within an interval and changes it after", async () => {
      graduatedCardRepository.findPage.mockResolvedValue({
        rows: [],
        total: 0,
      });
      const service = createService({ CHEERS_RANDOM_SEED_MINUTES: "60" });
      const seedAt = async (iso: string) => {
        jest.useFakeTimers({ now: new Date(iso) });
        await service.getGraduatedList(
          query(GraduatedListQueryDto, { sort: "random" }),
        );
        return graduatedCardRepository.findPage.mock.lastCall[0].seed;
      };

      const first = await seedAt("2026-10-26T10:00:00.000Z");
      const sameHour = await seedAt("2026-10-26T10:59:59.000Z");
      const nextHour = await seedAt("2026-10-26T11:00:00.000Z");

      expect(sameHour).toBe(first);
      expect(nextHour).not.toBe(first);
    });
  });

  describe("createRequest", () => {
    const req = { graduated_id: graduatedPk, message: "궁금합니다" };

    beforeEach(() => {
      studentRepository.findByUserPkWithLatestProfile.mockResolvedValue({
        student: { pk: studentPk },
        latest: { profile: { pk: profilePk } },
      });
      graduatedCardRepository.findRequestTarget.mockResolvedValue(target());
      coffeeChatRequestRepository.insert.mockResolvedValue({
        pk: requestPk,
        createdAt,
      });
    });

    it("saves the request with the latest profile and notifies after commit", async () => {
      const result = await createService().createRequest(userPk, req);

      expect(result).toEqual({
        id: requestPk,
        created_at: "2026-10-25T12:00:00.000Z",
      });
      expect(graduatedCardRepository.findRequestTarget).toHaveBeenCalledWith(
        graduatedPk,
        tx,
      );
      expect(coffeeChatRequestRepository.insert).toHaveBeenCalledWith(
        {
          graduatedPk,
          studentPk,
          studentProfilePk: profilePk,
          message: "궁금합니다",
        },
        tx,
      );
      expect(events).toEqual(["commit", "notify"]);

      expect(notificationService.notifyAsync).toHaveBeenCalledWith({
        coffeeChatRequestPk: requestPk,
        event: "coffee_chat_requested",
        email: expect.objectContaining({ to: "chulsoo@example.com" }),
        alimtalk: {
          to: "01000000000",
          variables: {
            recipientName: "김철수",
            coffeeChatRequestPk: requestPk,
          },
        },
      });
      const { email } = lastNotified();
      expect(email?.text).toContain(
        `https://cheers.example.com/cheers/received/${requestPk}`,
      );
    });

    it.each([
      [
        "email only",
        contact({ kakaoEnabled: false }),
        { email: true, alimtalk: false },
      ],
      [
        "kakao only",
        contact({ emailEnabled: false }),
        { email: false, alimtalk: true },
      ],
    ])(
      "notifies only the enabled channel (%s)",
      async (_, enabledContact, expected) => {
        graduatedCardRepository.findRequestTarget.mockResolvedValue(
          target({ contact: enabledContact }),
        );

        await createService().createRequest(userPk, req);

        const input = lastNotified();
        expect(input.email !== undefined).toBe(expected.email);
        expect(input.alimtalk !== undefined).toBe(expected.alimtalk);
      },
    );

    it("sends the mail without a link when WEB_BASE_URL is not set", async () => {
      await createService({ WEB_BASE_URL: undefined }).createRequest(
        userPk,
        req,
      );

      const { email } = lastNotified();
      expect(email?.text).not.toContain("/cheers/received/");
      expect(email?.html).not.toContain("<a ");
    });

    it("uses a fallback name when the graduated has no name", async () => {
      graduatedCardRepository.findRequestTarget.mockResolvedValue(
        target({ name: null }),
      );

      await createService().createRequest(userPk, req);

      const { alimtalk } = lastNotified();
      expect(alimtalk?.variables.recipientName).toBe("현업자");
    });

    it("rejects with 403 when the student has no profile", async () => {
      studentRepository.findByUserPkWithLatestProfile.mockResolvedValue({
        student: { pk: studentPk },
        latest: null,
      });

      await expect(createService().createRequest(userPk, req)).rejects.toThrow(
        ForbiddenException,
      );
      expect(coffeeChatRequestRepository.insert).not.toHaveBeenCalled();
    });

    it("rejects with 404 when the graduated is not visible", async () => {
      graduatedCardRepository.findRequestTarget.mockResolvedValue(null);

      await expect(createService().createRequest(userPk, req)).rejects.toThrow(
        new NotFoundException("Graduated not found"),
      );
      expect(coffeeChatRequestRepository.insert).not.toHaveBeenCalled();
      expect(notificationService.notifyAsync).not.toHaveBeenCalled();
    });

    it.each([
      ["no contact setting", null],
      [
        "both channels off",
        contact({ kakaoEnabled: false, emailEnabled: false }),
      ],
    ])("rejects with 409 when %s", async (_, graduatedContact) => {
      graduatedCardRepository.findRequestTarget.mockResolvedValue(
        target({ contact: graduatedContact }),
      );

      await expect(createService().createRequest(userPk, req)).rejects.toThrow(
        new ConflictException("Graduated does not accept coffee chat requests"),
      );
      expect(coffeeChatRequestRepository.insert).not.toHaveBeenCalled();
      expect(notificationService.notifyAsync).not.toHaveBeenCalled();
    });
  });

  describe("getSentList", () => {
    it("pages my requests and derives the status", async () => {
      coffeeChatRequestRepository.findSentPage.mockResolvedValue({
        rows: [
          sentRow(),
          sentRow({ graduatedViewedAt: createdAt }),
          sentRow({ graduatedViewedAt: createdAt, contactSharedAt: createdAt }),
        ],
        total: 3,
      });

      const result = await createService().getSentList(
        userPk,
        query(PaginationQueryDto, { page: 2, size: 10 }),
      );

      expect(coffeeChatRequestRepository.findSentPage).toHaveBeenCalledWith(
        userPk,
        10,
        10,
      );
      expect(result.items.map((item) => item.status)).toEqual([
        "requested",
        "viewed",
        "contact_shared",
      ]);
      expect(result.items[0]).toEqual({
        id: requestPk,
        graduated: {
          graduated_id: graduatedPk,
          nickname: "철수",
          company: "인포테크",
          job: "백엔드 개발자",
        },
        graduated_withdrawn: false,
        message: "궁금합니다",
        status: "requested",
        created_at: "2026-10-25T12:00:00.000Z",
      });
      expect(result).toMatchObject({ page: 2, size: 10, total: 3 });
    });

    it("flags requests whose graduated withdrew or is in the grace period", async () => {
      coffeeChatRequestRepository.findSentPage.mockResolvedValue({
        rows: [sentRow(), sentRow({ graduatedActive: false })],
        total: 2,
      });

      const result = await createService().getSentList(
        userPk,
        query(PaginationQueryDto, { page: 1, size: 20 }),
      );

      expect(result.items.map((item) => item.graduated_withdrawn)).toEqual([
        false,
        true,
      ]);
      // 닉네임 · 회사 · 직무는 그대로 보임
      expect(result.items[1].graduated.nickname).toBe("철수");
    });
  });

  describe("getSentDetail", () => {
    const sharedAt = new Date("2026-10-25T13:30:00.000Z");
    const shared = {
      graduatedViewedAt: createdAt,
      contactSharedAt: sharedAt,
      sharedEmail: "chulsoo@example.com",
      sharedPhone: "01000000000",
    };

    it("rejects with 404 when the request is not mine", async () => {
      coffeeChatRequestRepository.findSentByPk.mockResolvedValue(null);

      await expect(
        createService().getSentDetail(userPk, requestPk),
      ).rejects.toThrow(new NotFoundException("Coffee chat request not found"));
      expect(coffeeChatRequestRepository.findSentByPk).toHaveBeenCalledWith(
        requestPk,
        userPk,
        tx,
      );
    });

    it("returns no contact and records nothing before sharing", async () => {
      coffeeChatRequestRepository.findSentByPk.mockResolvedValue(detailRow());

      const result = await createService().getSentDetail(userPk, requestPk);

      expect(result.shared_contact).toBeNull();
      expect(result.status).toBe("requested");
      expect(
        coffeeChatRequestRepository.markStudentViewed,
      ).not.toHaveBeenCalled();
    });

    it("returns the shared contact and records the first view", async () => {
      coffeeChatRequestRepository.findSentByPk.mockResolvedValue(
        detailRow(shared),
      );

      const result = await createService().getSentDetail(userPk, requestPk);

      expect(
        coffeeChatRequestRepository.markStudentViewed,
      ).toHaveBeenCalledWith(requestPk, tx);
      expect(result.status).toBe("contact_shared");
      expect(result.shared_contact).toEqual({
        name: "김철수",
        email: "chulsoo@example.com",
        phone: "01000000000",
        shared_at: "2026-10-25T13:30:00.000Z",
      });
      expect(result.graduated_withdrawn).toBe(false);
    });

    it("does not record the view again", async () => {
      coffeeChatRequestRepository.findSentByPk.mockResolvedValue(
        detailRow({ ...shared, studentViewedAt: sharedAt }),
      );

      await createService().getSentDetail(userPk, requestPk);

      expect(
        coffeeChatRequestRepository.markStudentViewed,
      ).not.toHaveBeenCalled();
    });

    it.each([
      ["withdrawn (name purged)", { graduatedName: null }],
      ["in the withdrawal grace period", { graduatedName: "김철수" }],
    ])("hides the contact when the graduated is %s", async (_, overrides) => {
      coffeeChatRequestRepository.findSentByPk.mockResolvedValue(
        detailRow({ ...shared, ...overrides, graduatedActive: false }),
      );

      const result = await createService().getSentDetail(userPk, requestPk);

      expect(result.graduated_withdrawn).toBe(true);
      expect(result.shared_contact).toEqual({
        name: "탈퇴한 계정",
        email: null,
        phone: null,
        shared_at: "2026-10-25T13:30:00.000Z",
      });
    });
  });
});
