import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthService } from "@src/auth/auth.service";
import { DatabaseService } from "@src/database/database.service";
import { CoffeeChatContactRepository } from "@src/database/repository/coffee-chat-contact.repository";
import { GraduatedProfileRepository } from "@src/database/repository/graduated-profile.repository";
import {
  GraduatedRepository,
  GraduatedRow,
} from "@src/database/repository/graduated.repository";
import { GraduatedProfileRow } from "@src/database/repository/graduated-profile.repository";
import {
  UserRepository,
  UserRow,
} from "@src/database/repository/user.repository";
import { FileService } from "@src/file/file.service";
import { BaseResultDto } from "@src/global/dto/base-result.dto";
import { TxType } from "@src/global/types/tx.types";
import { GraduatedInfoRequestDto } from "./dto/graduated-info.dto";
import { GraduatedService } from "./graduated.service";

const USER_PK = "8f1d2c3b-0000-4000-8000-000000000001";
const GRADUATED_PK = "8f1d2c3b-0000-4000-8000-000000000002";
const TEMP_KEY = `tmp/business-card/${USER_PK}/new.jpg`;
const NEW_KEY = `business-card/${USER_PK}/new.jpg`;
const OLD_KEY = `business-card/${USER_PK}/old.jpg`;

const userRow = (overrides: Partial<UserRow> = {}): UserRow => ({
  pk: USER_PK,
  isDeleted: false,
  status: "pending",
  type: "graduated",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastActiveAt: new Date(),
  name: "김철수",
  email: "a@gmail.com",
  withdrawRequestedAt: null,
  ...overrides,
});

const graduatedRow = (overrides: Partial<GraduatedRow> = {}): GraduatedRow => ({
  pk: GRADUATED_PK,
  userPk: USER_PK,
  verifiedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  businessCardKey: null,
  ...overrides,
});

const profileRow = (
  overrides: Partial<GraduatedProfileRow> = {},
): GraduatedProfileRow => ({
  graduatedPk: GRADUATED_PK,
  nickname: "철수",
  company: "인포테크",
  department: "플랫폼개발팀",
  job: "백엔드 개발자",
  createdAt: new Date(),
  updatedAt: new Date(),
  hashtags: [],
  links: [],
  ...overrides,
});

const infoRequest = (
  overrides: Partial<GraduatedInfoRequestDto> = {},
): GraduatedInfoRequestDto => ({
  nickname: "철수",
  company: "인포테크",
  department: "플랫폼개발팀",
  job: "백엔드 개발자",
  hashtags: ["백엔드"],
  links: ["https://www.linkedin.com/in/chulsoo"],
  contact: {
    email_enabled: true,
    kakao_enabled: false,
    email: "chulsoo@example.com",
    phone: null,
  },
  ...overrides,
});

describe("GraduatedService", () => {
  const tx = {} as TxType;
  const dbService = {
    db: {
      transaction: jest.fn((fn: (tx: TxType) => unknown) => fn(tx)),
    },
  };
  const authService = { issueTokens: jest.fn() };
  const fileService = {
    confirmUpload: jest.fn(),
    deleteFileQuietly: jest.fn(),
  };
  const userRepository = {
    findByPkForUpdate: jest.fn(),
    fillName: jest.fn(),
    activate: jest.fn(),
  };
  const graduatedRepository = {
    findByUserPk: jest.fn(),
    findByUserPkWithProfile: jest.fn(),
    updateBusinessCard: jest.fn(),
  };
  const graduatedProfileRepository = { upsert: jest.fn() };
  const coffeeChatContactRepository = { upsert: jest.fn() };
  const service = new GraduatedService(
    dbService as unknown as DatabaseService,
    authService as unknown as AuthService,
    fileService as unknown as FileService,
    userRepository as unknown as UserRepository,
    graduatedRepository as unknown as GraduatedRepository,
    graduatedProfileRepository as unknown as GraduatedProfileRepository,
    coffeeChatContactRepository as unknown as CoffeeChatContactRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    userRepository.findByPkForUpdate.mockResolvedValue(userRow());
    fileService.confirmUpload.mockResolvedValue(NEW_KEY);
    fileService.deleteFileQuietly.mockResolvedValue(undefined);
    graduatedRepository.findByUserPk.mockResolvedValue(graduatedRow());
    graduatedRepository.findByUserPkWithProfile.mockResolvedValue({
      graduated: graduatedRow({ verifiedAt: new Date() }),
      profile: null,
    });
    authService.issueTokens.mockResolvedValue({
      accessToken: "access",
      refreshToken: "refresh",
    });
  });

  describe("verifyBusinessCard", () => {
    it("confirms the upload and stores the key on the first registration", async () => {
      await expect(
        service.verifyBusinessCard(USER_PK, TEMP_KEY),
      ).resolves.toEqual(BaseResultDto.OK);

      expect(fileService.confirmUpload).toHaveBeenCalledWith(
        USER_PK,
        "business_card",
        TEMP_KEY,
      );
      expect(graduatedRepository.updateBusinessCard).toHaveBeenCalledWith(
        GRADUATED_PK,
        NEW_KEY,
        tx,
      );
      expect(fileService.deleteFileQuietly).not.toHaveBeenCalled();
    });

    it("deletes the previous business card after commit when replacing", async () => {
      graduatedRepository.findByUserPk.mockResolvedValue(
        graduatedRow({ businessCardKey: OLD_KEY, verifiedAt: new Date() }),
      );

      await service.verifyBusinessCard(USER_PK, TEMP_KEY);

      expect(fileService.deleteFileQuietly).toHaveBeenCalledTimes(1);
      expect(fileService.deleteFileQuietly).toHaveBeenCalledWith(OLD_KEY);
    });

    it("does not touch the DB when the upload is rejected", async () => {
      fileService.confirmUpload.mockRejectedValue(
        new BadRequestException("Invalid file key"),
      );

      await expect(
        service.verifyBusinessCard(USER_PK, TEMP_KEY),
      ).rejects.toThrow(BadRequestException);
      expect(dbService.db.transaction).not.toHaveBeenCalled();
      expect(fileService.deleteFileQuietly).not.toHaveBeenCalled();
    });

    it("throws 401 and deletes the new file when the user is gone", async () => {
      userRepository.findByPkForUpdate.mockResolvedValue(null);

      await expect(
        service.verifyBusinessCard(USER_PK, TEMP_KEY),
      ).rejects.toThrow(UnauthorizedException);
      expect(fileService.deleteFileQuietly).toHaveBeenCalledWith(NEW_KEY);
      expect(graduatedRepository.updateBusinessCard).not.toHaveBeenCalled();
    });

    it("throws 403 and deletes the new file when the graduated row is gone", async () => {
      graduatedRepository.findByUserPk.mockResolvedValue(null);

      await expect(
        service.verifyBusinessCard(USER_PK, TEMP_KEY),
      ).rejects.toThrow(ForbiddenException);
      expect(fileService.deleteFileQuietly).toHaveBeenCalledWith(NEW_KEY);
    });

    it("rethrows the original error after deleting the new file", async () => {
      const dbError = new Error("db down");
      graduatedRepository.updateBusinessCard.mockRejectedValueOnce(dbError);

      await expect(service.verifyBusinessCard(USER_PK, TEMP_KEY)).rejects.toBe(
        dbError,
      );
      expect(fileService.deleteFileQuietly).toHaveBeenCalledWith(NEW_KEY);
    });
  });

  describe("saveInfo", () => {
    it("completes signup for a pending user and issues new tokens", async () => {
      await expect(service.saveInfo(USER_PK, infoRequest())).resolves.toEqual({
        result: "OK",
        access_token: "access",
        refresh_token: "refresh",
      });

      expect(graduatedProfileRepository.upsert).toHaveBeenCalledWith(
        {
          graduatedPk: GRADUATED_PK,
          nickname: "철수",
          company: "인포테크",
          department: "플랫폼개발팀",
          job: "백엔드 개발자",
          hashtags: ["백엔드"],
          links: ["https://www.linkedin.com/in/chulsoo"],
        },
        tx,
      );
      expect(coffeeChatContactRepository.upsert).toHaveBeenCalledWith(
        {
          userPk: USER_PK,
          emailEnabled: true,
          kakaoEnabled: false,
          email: "chulsoo@example.com",
          phone: null,
        },
        tx,
      );
      expect(userRepository.activate).toHaveBeenCalledWith(USER_PK, tx);
      expect(authService.issueTokens).toHaveBeenCalledWith(
        expect.objectContaining({ pk: USER_PK, status: "active" }),
        tx,
      );
      expect(userRepository.fillName).not.toHaveBeenCalled();
    });

    it("keeps the existing nickname and returns OK only for an active user", async () => {
      userRepository.findByPkForUpdate.mockResolvedValue(
        userRow({ status: "active" }),
      );
      graduatedRepository.findByUserPkWithProfile.mockResolvedValue({
        graduated: graduatedRow(),
        profile: profileRow({ nickname: "원래닉네임" }),
      });

      await expect(
        service.saveInfo(
          USER_PK,
          infoRequest({ nickname: "새닉네임", hashtags: undefined }),
        ),
      ).resolves.toEqual(BaseResultDto.OK);

      expect(graduatedProfileRepository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ nickname: "원래닉네임", hashtags: [] }),
        tx,
      );
      expect(userRepository.activate).not.toHaveBeenCalled();
      expect(authService.issueTokens).not.toHaveBeenCalled();
    });

    it("allows no contact method and drops the email and phone", async () => {
      await service.saveInfo(
        USER_PK,
        infoRequest({
          contact: {
            email_enabled: false,
            kakao_enabled: false,
            email: "chulsoo@example.com",
            phone: "01000000000",
          },
        }),
      );

      expect(coffeeChatContactRepository.upsert).toHaveBeenCalledWith(
        {
          userPk: USER_PK,
          emailEnabled: false,
          kakaoEnabled: false,
          email: null,
          phone: null,
        },
        tx,
      );
    });

    it("drops only the value of the contact method that is turned off", async () => {
      await service.saveInfo(
        USER_PK,
        infoRequest({
          contact: {
            email_enabled: false,
            kakao_enabled: true,
            email: "chulsoo@example.com",
            phone: "01000000000",
          },
        }),
      );

      expect(coffeeChatContactRepository.upsert).toHaveBeenCalledWith(
        {
          userPk: USER_PK,
          emailEnabled: false,
          kakaoEnabled: true,
          email: null,
          phone: "01000000000",
        },
        tx,
      );
    });

    it.each([
      [
        { email_enabled: true, kakao_enabled: false, email: null },
        "Contact email is required",
      ],
      [
        { email_enabled: false, kakao_enabled: true, phone: undefined },
        "Contact phone is required",
      ],
    ])(
      "rejects a chosen contact method without its value (%o)",
      async (contact, message) => {
        await expect(
          service.saveInfo(USER_PK, infoRequest({ contact })),
        ).rejects.toThrow(new BadRequestException(message));
        expect(dbService.db.transaction).not.toHaveBeenCalled();
      },
    );

    it("fills the name when OAuth did not provide one", async () => {
      userRepository.findByPkForUpdate.mockResolvedValue(
        userRow({ name: null }),
      );

      await service.saveInfo(USER_PK, infoRequest({ name: "김철수" }));

      expect(userRepository.fillName).toHaveBeenCalledWith(
        USER_PK,
        "김철수",
        tx,
      );
    });

    it("ignores the name when one is already stored", async () => {
      await service.saveInfo(USER_PK, infoRequest({ name: "다른이름" }));

      expect(userRepository.fillName).not.toHaveBeenCalled();
    });

    it("requires a name when none is stored", async () => {
      userRepository.findByPkForUpdate.mockResolvedValue(
        userRow({ name: null }),
      );

      await expect(service.saveInfo(USER_PK, infoRequest())).rejects.toThrow(
        new BadRequestException("Name is required"),
      );
      expect(graduatedProfileRepository.upsert).not.toHaveBeenCalled();
    });

    it("requires a nickname on the first save", async () => {
      await expect(
        service.saveInfo(USER_PK, infoRequest({ nickname: undefined })),
      ).rejects.toThrow(new BadRequestException("Nickname is required"));
      expect(graduatedProfileRepository.upsert).not.toHaveBeenCalled();
    });

    it("throws 401 when the user is gone", async () => {
      userRepository.findByPkForUpdate.mockResolvedValue(null);

      await expect(service.saveInfo(USER_PK, infoRequest())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("throws 403 when the graduated row is gone", async () => {
      graduatedRepository.findByUserPkWithProfile.mockResolvedValue(null);

      await expect(service.saveInfo(USER_PK, infoRequest())).rejects.toThrow(
        ForbiddenException,
      );
      expect(graduatedProfileRepository.upsert).not.toHaveBeenCalled();
    });
  });
});
