import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "@src/auth/auth.service";
import { UserContext } from "@src/auth/context/user-context";
import { DatabaseService } from "@src/database/database.service";
import { CoffeeChatContactRepository } from "@src/database/repository/coffee-chat-contact.repository";
import { GraduatedProfileRepository } from "@src/database/repository/graduated-profile.repository";
import { GraduatedRepository } from "@src/database/repository/graduated.repository";
import { StudentEmailVerificationRepository } from "@src/database/repository/student-email-verification.repository";
import { StudentProfileAttachmentRepository } from "@src/database/repository/student-profile-attachment.repository";
import { StudentProfileRepository } from "@src/database/repository/student-profile.repository";
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
  withdrawRequestedAt: null,
  ...overrides,
});

const googleProfile: OAuthProfile = {
  provider: "google",
  sub: "g-1",
  email: "a@gmail.com",
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
  const fileService = {
    deleteFileQuietly: jest.fn(),
    getPresignedUrl: jest.fn(),
  };
  const userRepository = {
    findByPk: jest.fn(),
    insert: jest.fn(),
    updateType: jest.fn(),
    fillEmail: jest.fn(),
    cancelWithdrawal: jest.fn(),
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
    findByUserPk: jest.fn(),
    findByUserPkWithLatestProfile: jest.fn(),
    clearEmailByUserPk: jest.fn(),
    deleteByPk: jest.fn(),
  };
  const studentProfileRepository = { deleteByStudentPk: jest.fn() };
  const studentProfileAttachmentRepository = {
    deleteByStudentPk: jest.fn(),
  };
  const studentEmailVerificationRepository = { deleteByStudentPk: jest.fn() };
  const graduatedRepository = {
    insert: jest.fn(),
    findByUserPk: jest.fn(),
    findByUserPkWithProfile: jest.fn(),
    clearBusinessCardKey: jest.fn(),
    deleteByPk: jest.fn(),
  };
  const graduatedProfileRepository = { deleteByGraduatedPk: jest.fn() };
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
    studentProfileRepository as unknown as StudentProfileRepository,
    studentProfileAttachmentRepository as unknown as StudentProfileAttachmentRepository,
    studentEmailVerificationRepository as unknown as StudentEmailVerificationRepository,
    graduatedRepository as unknown as GraduatedRepository,
    graduatedProfileRepository as unknown as GraduatedProfileRepository,
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
      const created = userRow({ type: "graduated" });
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
        { type: "graduated", email: "a@gmail.com" },
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
      expect(userRepository.fillEmail).toHaveBeenCalledWith(
        USER_PK,
        "a@gmail.com",
        tx,
      );
      expect(userRepository.updateType).not.toHaveBeenCalled();
      expect(graduatedRepository.insert).not.toHaveBeenCalled();
      expect(userRepository.cancelWithdrawal).not.toHaveBeenCalled();
      expect(authService.issueTokens).toHaveBeenCalledWith(active, tx);
    });

    it("does not fill the email when OAuth did not provide one", async () => {
      oauthService.verify.mockResolvedValue({ ...googleProfile, email: null });
      userOauthAccountRepository.findUserForLogin.mockResolvedValue(
        userRow({ status: "active" }),
      );

      await login("student");

      expect(userRepository.fillEmail).not.toHaveBeenCalled();
    });

    it("cancels a pending withdrawal when the user logs in during the grace period", async () => {
      const requested = userRow({
        status: "active",
        withdrawRequestedAt: new Date("2026-10-01T00:00:00Z"),
      });
      userOauthAccountRepository.findUserForLogin.mockResolvedValue(requested);
      userRepository.cancelWithdrawal.mockImplementation(record("cancel"));
      authService.issueTokens.mockImplementation(
        record("issueTokens", { accessToken: "a", refreshToken: "r" }),
      );

      await expect(login("student")).resolves.toEqual({
        access_token: "a",
        refresh_token: "r",
      });

      expect(userRepository.cancelWithdrawal).toHaveBeenCalledWith(USER_PK, tx);
      // 탈퇴 취소 뒤에 토큰을 발급 (last_active_at 갱신이 탈퇴 요청 유저를 건너뛰므로)
      expect(calls).toEqual(["cancel", "issueTokens"]);
    });

    it("continues signup for a pending user with the same type", async () => {
      const pending = userRow({ type: "student" });
      userOauthAccountRepository.findUserForLogin.mockResolvedValue(pending);

      await login("student");

      expect(studentRepository.deleteByPk).not.toHaveBeenCalled();
      expect(userRepository.updateType).not.toHaveBeenCalled();
      expect(authService.revokeAllTokens).not.toHaveBeenCalled();
      expect(authService.issueTokens).toHaveBeenCalledWith(pending, tx);
    });

    it("restarts a pending graduated as student and deletes the business card after commit", async () => {
      userOauthAccountRepository.findUserForLogin.mockResolvedValue(
        userRow({ type: "graduated" }),
      );
      graduatedRepository.findByUserPk.mockResolvedValue({
        pk: "graduated-1",
        businessCardKey: "business-card/a.jpg",
      });
      graduatedProfileRepository.deleteByGraduatedPk.mockImplementation(
        record("graduatedProfile.delete"),
      );
      graduatedRepository.deleteByPk.mockImplementation(
        record("graduated.delete"),
      );
      userRepository.updateType.mockImplementation(record("users.updateType"));
      studentRepository.insert.mockImplementation(record("student.insert"));
      authService.revokeAllTokens.mockImplementation(record("revokeAll"));
      authService.issueTokens.mockImplementation(
        record("issueTokens", { accessToken: "a", refreshToken: "r" }),
      );
      fileService.deleteFileQuietly.mockImplementation(record("s3.delete"));

      await login("student");

      expect(calls).toEqual([
        "graduatedProfile.delete",
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
      expect(
        graduatedProfileRepository.deleteByGraduatedPk,
      ).toHaveBeenCalledWith("graduated-1", tx);
      expect(graduatedRepository.deleteByPk).toHaveBeenCalledWith(
        "graduated-1",
        tx,
      );
      expect(fileService.deleteFileQuietly).toHaveBeenCalledWith(
        "business-card/a.jpg",
      );
    });

    it("restarts a pending student as graduated, deleting student rows children-first without touching S3", async () => {
      userOauthAccountRepository.findUserForLogin.mockResolvedValue(
        userRow({ type: "student" }),
      );
      studentRepository.findByUserPk.mockResolvedValue({ pk: "student-1" });
      studentEmailVerificationRepository.deleteByStudentPk.mockImplementation(
        record("verification.delete"),
      );
      studentProfileAttachmentRepository.deleteByStudentPk.mockImplementation(
        record("attachment.delete"),
      );
      studentProfileRepository.deleteByStudentPk.mockImplementation(
        record("profile.delete"),
      );
      studentRepository.deleteByPk.mockImplementation(record("student.delete"));
      graduatedRepository.insert.mockImplementation(record("graduated.insert"));

      await login("graduated");

      expect(calls).toEqual([
        "verification.delete",
        "attachment.delete",
        "profile.delete",
        "student.delete",
        "graduated.insert",
      ]);
      expect(studentRepository.deleteByPk).toHaveBeenCalledWith(
        "student-1",
        tx,
      );
      expect(graduatedRepository.insert).toHaveBeenCalledWith(USER_PK, tx);
      expect(fileService.deleteFileQuietly).not.toHaveBeenCalled();
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

    it("queries everything at once with the claim type when it matches the DB", async () => {
      userRepository.findByPk.mockResolvedValue(userRow({ type: "graduated" }));
      userRepository.findSignupProgress.mockResolvedValue(progress());
      coffeeChatContactRepository.findByUserPk.mockResolvedValue(null);
      graduatedRepository.findByUserPkWithProfile.mockResolvedValue({
        graduated: { pk: "graduated-1", verifiedAt: null },
        profile: null,
      });

      await service.getInfo(ctx("graduated"));

      expect(userRepository.findSignupProgress).toHaveBeenCalledTimes(1);
      expect(userRepository.findSignupProgress).toHaveBeenCalledWith(
        USER_PK,
        "graduated",
      );
      expect(graduatedRepository.findByUserPkWithProfile).toHaveBeenCalledTimes(
        1,
      );
      expect(
        studentRepository.findByUserPkWithLatestProfile,
      ).not.toHaveBeenCalled();
      expect(authService.touchLastActive).toHaveBeenCalledWith(USER_PK);
    });

    it("re-queries with the DB type and answers by DB type/status when the claim is stale", async () => {
      // 토큰은 student로 발급됐지만 다른 기기에서 graduated로 유형을 바꾼 상태
      userRepository.findByPk.mockResolvedValue(
        userRow({ type: "graduated", email: "a@gmail.com" }),
      );
      userRepository.findSignupProgress.mockResolvedValue(
        progress({ hasMissingRequiredConsent: true }),
      );
      coffeeChatContactRepository.findByUserPk.mockResolvedValue(null);
      studentRepository.findByUserPkWithLatestProfile.mockResolvedValue(null);
      graduatedRepository.findByUserPkWithProfile.mockResolvedValue({
        graduated: { pk: "graduated-1", verifiedAt: null },
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
      // 처음엔 클레임 type(student)으로, 불일치 확인 후 DB type(graduated)으로 다시 조회
      expect(userRepository.findSignupProgress).toHaveBeenNthCalledWith(
        1,
        USER_PK,
        "student",
      );
      expect(userRepository.findSignupProgress).toHaveBeenNthCalledWith(
        2,
        USER_PK,
        "graduated",
      );
      expect(
        studentRepository.findByUserPkWithLatestProfile,
      ).toHaveBeenCalledTimes(1);
      expect(graduatedRepository.findByUserPkWithProfile).toHaveBeenCalledWith(
        USER_PK,
      );
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
      studentRepository.findByUserPkWithLatestProfile.mockResolvedValue({
        student: {
          pk: "student-1",
          email: "gildong@gm.gist.ac.kr",
          verifiedAt: new Date(),
        },
        latest: {
          profile: { pk: "profile-2", interests: ["반도체"], activities: null },
          department: { pk: 1, name: "전기전자컴퓨터공학부" },
          // json_agg로 같은 쿼리에서 받은 첨부 (sort_order 순)
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
              key: null,
            },
            {
              kind: "cv",
              source: "file",
              url: "https://s3/presigned",
              file_name: "이력서.pdf",
              key: "cv/key.pdf",
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
      expect(
        studentRepository.findByUserPkWithLatestProfile,
      ).toHaveBeenCalledWith(USER_PK);
    });

    it("returns a null profile for a student who has not entered one yet", async () => {
      userRepository.findByPk.mockResolvedValue(userRow());
      userRepository.findSignupProgress.mockResolvedValue(progress());
      coffeeChatContactRepository.findByUserPk.mockResolvedValue(null);
      studentRepository.findByUserPkWithLatestProfile.mockResolvedValue({
        student: { pk: "student-1", email: null, verifiedAt: null },
        latest: null,
      });

      const info = await service.getInfo(ctx("student"));

      expect(info.student).toEqual({
        email: null,
        verified: false,
        profile: null,
      });
      expect(fileService.getPresignedUrl).not.toHaveBeenCalled();
    });

    it("flags consent_required for an active user missing a revised required consent", async () => {
      userRepository.findByPk.mockResolvedValue(
        userRow({ status: "active", type: "graduated" }),
      );
      userRepository.findSignupProgress.mockResolvedValue(
        progress({ hasMissingRequiredConsent: true }),
      );
      coffeeChatContactRepository.findByUserPk.mockResolvedValue(null);
      graduatedRepository.findByUserPkWithProfile.mockResolvedValue({
        graduated: { pk: "graduated-1", verifiedAt: new Date() },
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
});
