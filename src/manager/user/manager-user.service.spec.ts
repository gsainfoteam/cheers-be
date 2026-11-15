import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AdminAccessLogRepository } from "@src/admin-repository/admin-access-log.repository";
import { AdminUserRepository } from "@src/admin-repository/admin-user.repository";
import { ManagerContext } from "@src/manager/context/manager-context";
import { UserListQueryDto } from "@src/manager/user/dto/manager-user.dto";
import { ManagerUserService } from "./manager-user.service";

const USER_PK = "8f1d2c3b-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-31T00:00:00Z");

describe("ManagerUserService", () => {
  const userRepository = {
    findPage: jest.fn(),
    findByPk: jest.fn(),
    findOauthAccounts: jest.fn(),
    findContactFlags: jest.fn(),
    findContactByUserPk: jest.fn(),
    findConsents: jest.fn(),
    findStudentByUserPk: jest.fn(),
    findGraduatedByUserPk: jest.fn(),
  };
  const accessLogRepository = { insert: jest.fn() };
  const service = new ManagerUserService(
    userRepository as unknown as AdminUserRepository,
    accessLogRepository as unknown as AdminAccessLogRepository,
  );
  const manager = new ManagerContext("me", "me@gm.gist.ac.kr", "admin");

  beforeEach(() => jest.resetAllMocks());

  const query = (overrides: Partial<UserListQueryDto> = {}) =>
    ({ page: 2, size: 20, ...overrides }) as UserListQueryDto;

  const listRow = (overrides: object = {}) => ({
    pk: USER_PK,
    name: "김학생",
    email: "student@gm.gist.ac.kr",
    type: "student",
    status: "active",
    isDeleted: false,
    withdrawRequestedAt: null,
    createdAt: NOW,
    lastActiveAt: NOW,
    school: "GIST",
    department: "전기전자컴퓨터공학과",
    company: null,
    job: null,
    ...overrides,
  });

  const userRow = (overrides: object = {}) => ({
    pk: USER_PK,
    name: "김학생",
    email: "student@gm.gist.ac.kr",
    type: "student",
    status: "active",
    isDeleted: false,
    withdrawRequestedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    lastActiveAt: NOW,
    ...overrides,
  });

  describe("listUsers", () => {
    it("페이지를 offset으로 바꾸고 검색어 · 필터를 레포지토리에 넘김", async () => {
      userRepository.findPage.mockResolvedValue({
        rows: [listRow()],
        total: 21,
      });

      const result = await service.listUsers(
        query({
          type: "student",
          status: "active",
          withdrawal: "none",
          q: "abc",
          created_from: "2026-10-01T00:00:00Z",
          created_to: "2026-11-01T00:00:00Z",
        }),
      );

      expect(userRepository.findPage).toHaveBeenCalledWith(
        {
          type: "student",
          status: "active",
          withdrawal: "none",
          keyword: "abc",
          createdFrom: new Date("2026-10-01T00:00:00Z"),
          createdTo: new Date("2026-11-01T00:00:00Z"),
        },
        20,
        20,
      );
      expect(result).toEqual({
        items: [
          {
            pk: USER_PK,
            name: "김학생",
            email: "student@gm.gist.ac.kr",
            type: "student",
            status: "active",
            withdrawal_state: "none",
            affiliation: {
              school: "GIST",
              department: "전기전자컴퓨터공학과",
              company: null,
              job: null,
            },
            created_at: NOW,
            last_active_at: NOW,
          },
        ],
        page: 2,
        size: 20,
        total: 21,
      });
    });

    it("withdrawal=all은 필터 없음으로 처리", async () => {
      userRepository.findPage.mockResolvedValue({ rows: [], total: 0 });

      await service.listUsers(query({ withdrawal: "all" }));

      expect(userRepository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ withdrawal: undefined }),
        20,
        20,
      );
    });

    it("탈퇴 상태: 완료가 유예보다 우선", async () => {
      userRepository.findPage.mockResolvedValue({
        rows: [
          listRow({ pk: "a" }),
          listRow({ pk: "b", withdrawRequestedAt: NOW }),
          listRow({ pk: "c", withdrawRequestedAt: NOW, isDeleted: true }),
        ],
        total: 3,
      });

      const { items } = await service.listUsers(query());

      expect(items.map((item) => item.withdrawal_state)).toEqual([
        "none",
        "requested",
        "deleted",
      ]);
    });

    it("created_from이 created_to보다 늦으면 400", async () => {
      await expect(
        service.listUsers(
          query({
            created_from: "2026-11-01T00:00:00Z",
            created_to: "2026-10-01T00:00:00Z",
          }),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(userRepository.findPage).not.toHaveBeenCalled();
    });
  });

  describe("getUser", () => {
    it("없는 회원이면 404", async () => {
      userRepository.findByPk.mockResolvedValue(null);

      await expect(service.getUser(USER_PK)).rejects.toThrow(NotFoundException);
      expect(userRepository.findOauthAccounts).not.toHaveBeenCalled();
    });

    it("재학생: 학생 프로필만 조회하고 연락처 값은 포함하지 않음", async () => {
      userRepository.findByPk.mockResolvedValue(userRow());
      userRepository.findOauthAccounts.mockResolvedValue([
        {
          provider: "google",
          email: "g@gmail.com",
          createdAt: NOW,
          lastLoginAt: NOW,
        },
      ]);
      userRepository.findContactFlags.mockResolvedValue({
        kakaoEnabled: true,
        emailEnabled: false,
      });
      userRepository.findConsents.mockResolvedValue([
        {
          consentType: "terms",
          consentVersion: "1",
          agreedAt: NOW,
          revokedAt: null,
        },
      ]);
      userRepository.findStudentByUserPk.mockResolvedValue({
        studentPk: "student-pk",
        schoolEmail: "student@gm.gist.ac.kr",
        verifiedAt: NOW,
        school: "GIST",
        department: "전기전자컴퓨터공학과",
        interests: ["백엔드"],
        activities: null,
        requestCount: 3,
      });

      const detail = await service.getUser(USER_PK);

      expect(userRepository.findGraduatedByUserPk).not.toHaveBeenCalled();
      expect(detail).toEqual({
        pk: USER_PK,
        name: "김학생",
        email: "student@gm.gist.ac.kr",
        type: "student",
        status: "active",
        withdrawal_state: "none",
        created_at: NOW,
        updated_at: NOW,
        last_active_at: NOW,
        withdraw_requested_at: null,
        oauth_accounts: [
          {
            provider: "google",
            email: "g@gmail.com",
            created_at: NOW,
            last_login_at: NOW,
          },
        ],
        contact_methods: { kakao_enabled: true, email_enabled: false },
        consents: [
          { type: "terms", version: "1", agreed_at: NOW, revoked_at: null },
        ],
        student: {
          student_pk: "student-pk",
          school_email: "student@gm.gist.ac.kr",
          verified_at: NOW,
          school: "GIST",
          department: "전기전자컴퓨터공학과",
          interests: ["백엔드"],
          activities: null,
        },
        graduated: null,
        coffee_chat_request_count: 3,
      });
      expect(JSON.stringify(detail)).not.toContain("phone");
    });

    it("현업자: 현업자 프로필과 명함 등록 여부를 내려줌", async () => {
      userRepository.findByPk.mockResolvedValue(
        userRow({ type: "graduated", name: "박현업" }),
      );
      userRepository.findOauthAccounts.mockResolvedValue([]);
      userRepository.findContactFlags.mockResolvedValue(null);
      userRepository.findConsents.mockResolvedValue([]);
      userRepository.findGraduatedByUserPk.mockResolvedValue({
        graduatedPk: "graduated-pk",
        verifiedAt: NOW,
        hasBusinessCard: true,
        nickname: "현업",
        company: "인포테크",
        department: null,
        job: "개발자",
        hashtags: null,
        links: ["https://example.com"],
        requestCount: 5,
      });

      const detail = await service.getUser(USER_PK);

      expect(userRepository.findStudentByUserPk).not.toHaveBeenCalled();
      expect(detail.student).toBeNull();
      expect(detail.contact_methods).toBeNull();
      expect(detail.graduated).toEqual({
        graduated_pk: "graduated-pk",
        verified_at: NOW,
        has_business_card: true,
        nickname: "현업",
        company: "인포테크",
        department: null,
        job: "개발자",
        hashtags: null,
        links: ["https://example.com"],
      });
      expect(detail.coffee_chat_request_count).toBe(5);
    });

    it("가입 중이라 프로필이 없으면 student · graduated는 null, 요청 수는 0", async () => {
      userRepository.findByPk.mockResolvedValue(
        userRow({ status: "pending", name: null, email: null }),
      );
      userRepository.findOauthAccounts.mockResolvedValue([]);
      userRepository.findContactFlags.mockResolvedValue(null);
      userRepository.findConsents.mockResolvedValue([]);
      userRepository.findStudentByUserPk.mockResolvedValue(null);

      const detail = await service.getUser(USER_PK);

      expect(detail.student).toBeNull();
      expect(detail.graduated).toBeNull();
      expect(detail.coffee_chat_request_count).toBe(0);
    });
  });

  describe("getContact", () => {
    it("열람 기록을 남긴 뒤 연락처 값을 내려줌", async () => {
      userRepository.findContactByUserPk.mockResolvedValue({
        kakaoEnabled: true,
        emailEnabled: true,
        phone: "01012345678",
        email: "a@example.com",
      });
      accessLogRepository.insert.mockResolvedValue(undefined);

      await expect(service.getContact(USER_PK, manager)).resolves.toEqual({
        kakao_enabled: true,
        email_enabled: true,
        phone: "01012345678",
        email: "a@example.com",
      });
      // 연락처 값은 기록에 넣지 않음
      expect(accessLogRepository.insert).toHaveBeenCalledWith({
        adminEmail: "me@gm.gist.ac.kr",
        targetType: "user_contact",
        targetId: USER_PK,
      });
    });

    it("연락처가 없으면 404이고 열람 기록도 남기지 않음", async () => {
      userRepository.findContactByUserPk.mockResolvedValue(null);

      await expect(service.getContact(USER_PK, manager)).rejects.toThrow(
        NotFoundException,
      );
      expect(accessLogRepository.insert).not.toHaveBeenCalled();
    });

    it("열람 기록 저장에 실패하면 값을 내려주지 않음", async () => {
      userRepository.findContactByUserPk.mockResolvedValue({
        kakaoEnabled: true,
        emailEnabled: false,
        phone: "01012345678",
        email: null,
      });
      accessLogRepository.insert.mockRejectedValue(new Error("db down"));

      await expect(service.getContact(USER_PK, manager)).rejects.toThrow(
        "db down",
      );
    });
  });
});
