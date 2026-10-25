import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "@src/auth/auth.service";
import { UserContext } from "@src/auth/context/user-context";
import { DatabaseService } from "@src/database/database.service";
import { CoffeeChatContactRepository } from "@src/database/repository/coffee-chat-contact.repository";
import { GraduatedRepository } from "@src/database/repository/graduated.repository";
import { StudentRepository } from "@src/database/repository/student.repository";
import { UserOauthAccountRepository } from "@src/database/repository/user-oauth-account.repository";
import {
  SignupProgress,
  UserRepository,
  UserRow,
} from "@src/database/repository/user.repository";
import { FileService } from "@src/file/file.service";
import { BaseResultDto } from "@src/global/dto/base-result.dto";
import { TxType } from "@src/global/types/tx.types";
import { OAuthService } from "@src/user/oauth/oauth.service";
import { OAuthProfile } from "@src/user/oauth/oauth.types";
import { UserService } from "./user.service";

const USER_PK = "8f1d2c3b-0000-4000-8000-000000000001";

const userRow = (overrides: Partial<UserRow> = {}): UserRow => ({
  pk: USER_PK,
  isDeleted: false,
  status: "pending",
  type: "student",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastActiveAt: new Date(),
  name: null,
  email: null,
  ...overrides,
});

const googleProfile: OAuthProfile = {
  provider: "google",
  sub: "g-1",
  email: "a@gmail.com",
  name: "홍길동",
};

const progress = (overrides: Partial<SignupProgress> = {}): SignupProgress => ({
  hasMissingRequiredConsent: false,
  verified: false,
  hasProfile: false,
  ...overrides,
});

describe("UserService", () => {
  const tx = {} as TxType;
  // 트랜잭션 안에서 호출된 순서를 확인하기 위한 기록
  let calls: string[];
  const record =
    (name: string, value?: unknown) =>
    (..._args: unknown[]) => {
      calls.push(name);
      return Promise.resolve(value);
    };

  const dbService = {
    db: { transaction: (fn: (tx: TxType) => unknown) => fn(tx) },
  };
  const authService = {
    issueTokens: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
    revokeAllTokens: jest.fn(),
    touchLastActive: jest.fn(),
  };
  const oauthService = { verify: jest.fn() };
  const fileService = { deleteFile: jest.fn(), getPresignedUrl: jest.fn() };
  const userRepository = {
    findByPk: jest.fn(),
    insert: jest.fn(),
    updateType: jest.fn(),
    fillProfileFromOAuth: jest.fn(),
    withdraw: jest.fn(),
    findSignupProgress: jest.fn(),
  };
  const userOauthAccountRepository = {
    findUserForLogin: jest.fn(),
    insert: jest.fn(),
    updateLastLogin: jest.fn(),
    deleteByUserPk: jest.fn(),
  };
  const studentRepository = {
    insert: jest.fn(),
    deleteByUserPk: jest.fn(),
    clearEmail: jest.fn(),
    findInfoByUserPk: jest.fn(),
  };
  const graduatedRepository = {
    insert: jest.fn(),
    deleteByUserPk: jest.fn(),
    clearBusinessCard: jest.fn(),
    findInfoByUserPk: jest.fn(),
  };
  const coffeeChatContactRepository = {
    findByUserPk: jest.fn(),
    deleteByUserPk: jest.fn(),
  };

  const service = new UserService(
    dbService as unknown as DatabaseService,
    authService as unknown as AuthService,
    oauthService as unknown as OAuthService,
    fileService as unknown as FileService,
    userRepository as unknown as UserRepository,
    userOauthAccountRepository as unknown as UserOauthAccountRepository,
    studentRepository as unknown as StudentRepository,
    graduatedRepository as unknown as GraduatedRepository,
    coffeeChatContactRepository as unknown as CoffeeChatContactRepository,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    calls = [];
    oauthService.verify.mockResolvedValue(googleProfile);
    authService.issueTokens.mockResolvedValue({
      accessToken: "access",
      refreshToken: "refresh",
    });
  });

  describe("login", () => {
    const login = (type: "student" | "graduated") =>
      service.login({
        provider: "google",
        type,
        token: "id-token",
        nonce: "raw-nonce",
      });

    it("creates a pending user, oauth account and type row on first login", async () => {
      const created = userRow({ type: "graduated", name: "홍길동" });
      userOauthAccountRepository.findUserForLogin.mockResolvedValue(null);
      userRepository.insert.mockResolvedValue(created);
      userOauthAccountRepository.insert.mockResolvedValue({});

      await expect(login("graduated")).resolves.toEqual({
        access_token: "access",
        refresh_token: "refresh",
      });

      expect(oauthService.verify).toHaveBeenCalledWith(
        "google",
        "id-token",
        "raw-nonce",
      );
      expect(userRepository.insert).toHaveBeenCalledWith(
        { type: "graduated", name: "홍길동", email: "a@gmail.com" },
        tx,
      );
      expect(userOauthAccountRepository.insert).toHaveBeenCalledWith(
        {
          provider: "google",
          providerSub: "g-1",
          userPk: USER_PK,
          email: "a@gmail.com",
        },
        tx,
      );
      expect(graduatedRepository.insert).toHaveBeenCalledWith(USER_PK, tx);
      expect(studentRepository.insert).not.toHaveBeenCalled();
      expect(authService.issueTokens).toHaveBeenCalledWith(created, tx);
    });

    it("returns 409 when the same account signs up concurrently", async () => {
      userOauthAccountRepository.findUserForLogin.mockResolvedValue(null);
      userRepository.insert.mockResolvedValue(userRow());
      userOauthAccountRepository.insert.mockResolvedValue(null);

      await expect(login("student")).rejects.toBeInstanceOf(ConflictException);
      expect(studentRepository.insert).not.toHaveBeenCalled();
      expect(authService.issueTokens).not.toHaveBeenCalled();
    });

    it("ignores type for an active user", async () => {
      const active = userRow({ status: "active", type: "student" });
      userOauthAccountRepository.findUserForLogin.mockResolvedValue(active);

      await login("graduated");

      expect(userOauthAccountRepository.updateLastLogin).toHaveBeenCalledWith(
        "google",
        "g-1",
        "a@gmail.com",
        tx,
      );
      expect(userRepository.fillProfileFromOAuth).toHaveBeenCalledWith(
        USER_PK,
        { name: "홍길동", email: "a@gmail.com" },
        tx,
      );
      expect(userRepository.updateType).not.toHaveBeenCalled();
      expect(graduatedRepository.insert).not.toHaveBeenCalled();
      expect(authService.issueTokens).toHaveBeenCalledWith(active, tx);
    });

    it("continues signup for a pending user with the same type", async () => {
      const pending = userRow({ type: "student" });
      userOauthAccountRepository.findUserForLogin.mockResolvedValue(pending);

      await login("student");

      expect(studentRepository.deleteByUserPk).not.toHaveBeenCalled();
      expect(userRepository.updateType).not.toHaveBeenCalled();
      expect(authService.revokeAllTokens).not.toHaveBeenCalled();
      expect(authService.issueTokens).toHaveBeenCalledWith(pending, tx);
    });

    it("restarts a pending graduated as student and deletes the business card after commit", async () => {
      userOauthAccountRepository.findUserForLogin.mockResolvedValue(
        userRow({ type: "graduated" }),
      );
      graduatedRepository.deleteByUserPk.mockImplementation(
        record("graduated.delete", "business-card/a.jpg"),
      );
      userRepository.updateType.mockImplementation(record("users.updateType"));
      studentRepository.insert.mockImplementation(record("student.insert"));
      authService.revokeAllTokens.mockImplementation(record("revokeAll"));
      authService.issueTokens.mockImplementation(
        record("issueTokens", { accessToken: "a", refreshToken: "r" }),
      );
      fileService.deleteFile.mockImplementation(record("s3.delete"));

      await login("student");

      expect(calls).toEqual([
        "graduated.delete",
        "users.updateType",
        "student.insert",
        "revokeAll",
        "issueTokens",
        "s3.delete",
      ]);
      expect(userRepository.updateType).toHaveBeenCalledWith(
        USER_PK,
        "student",
        tx,
      );
      expect(authService.issueTokens).toHaveBeenCalledWith(
        expect.objectContaining({ pk: USER_PK, type: "student" }),
        tx,
      );
      expect(fileService.deleteFile).toHaveBeenCalledWith(
        "business-card/a.jpg",
      );
    });

    it("restarts a pending student as graduated without touching S3", async () => {
      userOauthAccountRepository.findUserForLogin.mockResolvedValue(
        userRow({ type: "student" }),
      );

      await login("graduated");

      expect(studentRepository.deleteByUserPk).toHaveBeenCalledWith(
        USER_PK,
        tx,
      );
      expect(graduatedRepository.insert).toHaveBeenCalledWith(USER_PK, tx);
      expect(fileService.deleteFile).not.toHaveBeenCalled();
    });

    it("still logs in when deleting the old business card fails", async () => {
      userOauthAccountRepository.findUserForLogin.mockResolvedValue(
        userRow({ type: "graduated" }),
      );
      graduatedRepository.deleteByUserPk.mockResolvedValue(
        "business-card/a.jpg",
      );
      fileService.deleteFile.mockRejectedValue(new Error("S3 down"));

      await expect(login("student")).resolves.toEqual({
        access_token: "access",
        refresh_token: "refresh",
      });
    });

    it("does not touch the DB when the OAuth token is invalid", async () => {
      oauthService.verify.mockRejectedValue(new UnauthorizedException());

      await expect(login("student")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(
        userOauthAccountRepository.findUserForLogin,
      ).not.toHaveBeenCalled();
    });
  });

  describe("getInfo", () => {
    const ctx = (type: "student" | "graduated") =>
      new UserContext(USER_PK, type, "pending");

    it("returns 401 for a withdrawn or missing user", async () => {
      userRepository.findByPk.mockResolvedValue(null);

      await expect(service.getInfo(ctx("student"))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("uses the DB type and status rather than the token claims", async () => {
      userRepository.findByPk.mockResolvedValue(
        userRow({ type: "graduated", email: "a@gmail.com" }),
      );
      userRepository.findSignupProgress.mockResolvedValue(
        progress({ hasMissingRequiredConsent: true }),
      );
      coffeeChatContactRepository.findByUserPk.mockResolvedValue(null);
      graduatedRepository.findInfoByUserPk.mockResolvedValue({
        graduated: { verifiedAt: null },
        profile: null,
      });

      await expect(service.getInfo(ctx("student"))).resolves.toEqual({
        id: USER_PK,
        type: "graduated",
        status: "pending",
        next_step: "consent",
        name: null,
        email: "a@gmail.com",
        // 가입 중에는 next_step으로 안내
        consent_required: false,
        student: null,
        graduated: { verified: false, profile: null },
      });
      expect(userRepository.findSignupProgress).toHaveBeenCalledWith(
        USER_PK,
        "graduated",
      );
      expect(studentRepository.findInfoByUserPk).not.toHaveBeenCalled();
      expect(authService.touchLastActive).toHaveBeenCalledWith(USER_PK);
    });

    it("maps an active student's latest profile, attachments and contact", async () => {
      userRepository.findByPk.mockResolvedValue(
        userRow({ status: "active", name: "홍길동" }),
      );
      userRepository.findSignupProgress.mockResolvedValue(
        progress({ verified: true, hasProfile: true }),
      );
      coffeeChatContactRepository.findByUserPk.mockResolvedValue({
        emailEnabled: true,
        kakaoEnabled: false,
        email: "gildong@gm.gist.ac.kr",
        phone: null,
      });
      studentRepository.findInfoByUserPk.mockResolvedValue({
        student: { email: "gildong@gm.gist.ac.kr", verifiedAt: new Date() },
        profile: {
          profile: { interests: ["반도체"], activities: null },
          department: { pk: 1, name: "전기전자컴퓨터공학부" },
          attachments: [
            {
              kind: "portfolio",
              source: "link",
              url: "https://portfolio.example.com",
              fileName: null,
            },
            {
              kind: "cv",
              source: "file",
              url: "cv/key.pdf",
              fileName: "이력서.pdf",
            },
          ],
        },
      });
      fileService.getPresignedUrl.mockResolvedValue("https://s3/presigned");

      const info = await service.getInfo(ctx("student"));

      expect(info.next_step).toBeNull();
      expect(info.consent_required).toBe(false);
      expect(info.graduated).toBeNull();
      expect(info.student).toEqual({
        email: "gildong@gm.gist.ac.kr",
        verified: true,
        profile: {
          department: { id: 1, name: "전기전자컴퓨터공학부" },
          interests: ["반도체"],
          activities: [],
          attachments: [
            {
              kind: "portfolio",
              source: "link",
              url: "https://portfolio.example.com",
              file_name: null,
            },
            {
              kind: "cv",
              source: "file",
              url: "https://s3/presigned",
              file_name: "이력서.pdf",
            },
          ],
          contact: {
            email_enabled: true,
            kakao_enabled: false,
            email: "gildong@gm.gist.ac.kr",
            phone: null,
          },
        },
      });
      expect(fileService.getPresignedUrl).toHaveBeenCalledWith("cv/key.pdf");
    });

    it("flags consent_required for an active user missing a revised required consent", async () => {
      userRepository.findByPk.mockResolvedValue(
        userRow({ status: "active", type: "graduated" }),
      );
      userRepository.findSignupProgress.mockResolvedValue(
        progress({ hasMissingRequiredConsent: true }),
      );
      coffeeChatContactRepository.findByUserPk.mockResolvedValue(null);
      graduatedRepository.findInfoByUserPk.mockResolvedValue({
        graduated: { verifiedAt: new Date() },
        profile: {
          nickname: "철수",
          company: "인포테크",
          department: "플랫폼개발팀",
          job: "백엔드 개발자",
          hashtags: null,
          links: ["https://www.linkedin.com/in/chulsoo"],
        },
      });

      const info = await service.getInfo(ctx("graduated"));

      expect(info.next_step).toBeNull();
      expect(info.consent_required).toBe(true);
      expect(info.graduated?.profile).toEqual({
        nickname: "철수",
        company: "인포테크",
        department: "플랫폼개발팀",
        job: "백엔드 개발자",
        hashtags: [],
        links: ["https://www.linkedin.com/in/chulsoo"],
        contact: null,
      });
    });
  });

  describe("refresh / logout", () => {
    it("maps refreshed tokens to snake_case", async () => {
      authService.refresh.mockResolvedValue({
        accessToken: "a2",
        refreshToken: "r2",
      });

      await expect(service.refresh({ refresh_token: "r1" })).resolves.toEqual({
        access_token: "a2",
        refresh_token: "r2",
      });
      expect(authService.refresh).toHaveBeenCalledWith("r1");
    });

    it("revokes only the given refresh token of the current user", async () => {
      await expect(
        service.logout(
          { refresh_token: "r1" },
          new UserContext(USER_PK, "student", "pending"),
        ),
      ).resolves.toBe(BaseResultDto.OK);
      expect(authService.logout).toHaveBeenCalledWith("r1", USER_PK);
    });
  });

  describe("withdraw", () => {
    const ctx = new UserContext(USER_PK, "graduated", "active");

    it("removes login methods and personal info, then deletes the business card", async () => {
      userRepository.findByPk.mockResolvedValue(
        userRow({ status: "active", type: "graduated" }),
      );
      userOauthAccountRepository.deleteByUserPk.mockImplementation(
        record("oauth.delete"),
      );
      authService.revokeAllTokens.mockImplementation(record("revokeAll"));
      coffeeChatContactRepository.deleteByUserPk.mockImplementation(
        record("contact.delete"),
      );
      graduatedRepository.clearBusinessCard.mockImplementation(
        record("graduated.clearBusinessCard", "business-card/a.jpg"),
      );
      userRepository.withdraw.mockImplementation(record("users.withdraw"));
      fileService.deleteFile.mockImplementation(record("s3.delete"));

      await expect(service.withdraw(ctx)).resolves.toBe(BaseResultDto.OK);

      expect(calls).toEqual([
        "oauth.delete",
        "revokeAll",
        "contact.delete",
        "graduated.clearBusinessCard",
        "users.withdraw",
        "s3.delete",
      ]);
      expect(fileService.deleteFile).toHaveBeenCalledWith(
        "business-card/a.jpg",
      );
      expect(studentRepository.clearEmail).not.toHaveBeenCalled();
    });

    it("clears the school email of a student", async () => {
      userRepository.findByPk.mockResolvedValue(
        userRow({ status: "active", type: "student" }),
      );

      await service.withdraw(ctx);

      expect(studentRepository.clearEmail).toHaveBeenCalledWith(USER_PK, tx);
      expect(graduatedRepository.clearBusinessCard).not.toHaveBeenCalled();
      expect(userRepository.withdraw).toHaveBeenCalledWith(USER_PK, tx);
      expect(fileService.deleteFile).not.toHaveBeenCalled();
    });

    it("returns 401 when the user is already withdrawn", async () => {
      userRepository.findByPk.mockResolvedValue(null);

      await expect(service.withdraw(ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(userRepository.withdraw).not.toHaveBeenCalled();
    });
  });
});
