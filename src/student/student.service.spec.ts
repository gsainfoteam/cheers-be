import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthService } from "@src/auth/auth.service";
import { DatabaseService } from "@src/database/database.service";
import { CoffeeChatContactRepository } from "@src/database/repository/coffee-chat-contact.repository";
import { DepartmentRepository } from "@src/database/repository/department.repository";
import { StudentProfileAttachmentRepository } from "@src/database/repository/student-profile-attachment.repository";
import { StudentProfileRepository } from "@src/database/repository/student-profile.repository";
import {
  StudentRepository,
  StudentWithLatestProfile,
} from "@src/database/repository/student.repository";
import {
  UserRepository,
  UserRow,
} from "@src/database/repository/user.repository";
import { FileService } from "@src/file/file.service";
import { TxType } from "@src/global/types/tx.types";
import { SaveStudentInfoRequestDto } from "./dto/save-student-info.dto";
import { InterestService } from "./interest.service";
import { StudentService } from "./student.service";

const userPk = "690c15dc-0000-4000-8000-000000000001";
const now = new Date("2026-10-25T12:00:00.000Z");

const user = (overrides: Partial<UserRow> = {}): UserRow => ({
  pk: userPk,
  isDeleted: false,
  status: "pending",
  type: "student",
  createdAt: now,
  updatedAt: now,
  lastActiveAt: now,
  name: "홍길동",
  email: "gildong@gmail.com",
  withdrawRequestedAt: null,
  ...overrides,
});

const studentRow = {
  pk: "student-pk",
  userPk,
  email: "gildong@gm.gist.ac.kr",
  verifiedAt: now,
  createdAt: now,
  updatedAt: now,
};

const latest: NonNullable<StudentWithLatestProfile["latest"]> = {
  profile: {
    pk: "profile-v2",
    studentPk: studentRow.pk,
    version: 2,
    departmentPk: 1,
    interests: ["반도체", "소프트웨어"],
    activities: null,
    createdAt: now,
  },
  department: { pk: 1, name: "전기전자컴퓨터공학부" },
  attachments: [
    {
      kind: "portfolio",
      source: "link",
      url: "https://portfolio.example.com",
      fileName: null,
    },
  ],
};

const request = (
  overrides: Partial<SaveStudentInfoRequestDto> = {},
): SaveStudentInfoRequestDto => ({
  department_id: 1,
  interests: ["반도체", "소프트웨어"],
  attachments: [
    {
      kind: "portfolio",
      source: "link",
      url: "https://portfolio.example.com",
    },
  ],
  contact: {
    email_enabled: true,
    kakao_enabled: false,
    email: "gildong@gm.gist.ac.kr",
    phone: null,
  },
  ...overrides,
});

describe("StudentService", () => {
  const tx = {} as TxType;
  const dbService = {
    db: { transaction: (fn: (tx: TxType) => unknown) => fn(tx) },
  };
  const authService = { issueTokens: jest.fn() };
  const fileService = { confirmUpload: jest.fn(), deleteFile: jest.fn() };
  const userRepository = {
    findByPkForUpdate: jest.fn(),
    fillName: jest.fn(),
    activate: jest.fn(),
  };
  const studentRepository = {
    findByUserPk: jest.fn(),
    findByUserPkWithLatestProfile: jest.fn(),
  };
  const departmentRepository = {
    findByEmailDomain: jest.fn(),
    findByPkAndEmailDomain: jest.fn(),
  };
  const profileRepository = { insert: jest.fn() };
  const attachmentRepository = { insertMany: jest.fn() };
  const contactRepository = { upsert: jest.fn() };
  const interestService = { getNames: jest.fn() };
  const service = new StudentService(
    dbService as unknown as DatabaseService,
    authService as unknown as AuthService,
    fileService as unknown as FileService,
    userRepository as unknown as UserRepository,
    studentRepository as unknown as StudentRepository,
    departmentRepository as unknown as DepartmentRepository,
    profileRepository as unknown as StudentProfileRepository,
    attachmentRepository as unknown as StudentProfileAttachmentRepository,
    contactRepository as unknown as CoffeeChatContactRepository,
    interestService as unknown as InterestService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    userRepository.findByPkForUpdate.mockResolvedValue(user());
    studentRepository.findByUserPkWithLatestProfile.mockResolvedValue({
      student: studentRow,
      latest: null,
    });
    departmentRepository.findByPkAndEmailDomain.mockResolvedValue({
      pk: 1,
      schoolPk: 1,
      name: "전기전자컴퓨터공학부",
      isActive: true,
    });
    profileRepository.insert.mockResolvedValue({ pk: "new-profile" });
    authService.issueTokens.mockResolvedValue({
      accessToken: "access",
      refreshToken: "refresh",
    });
  });

  it("getDepartments lists departments of the verified email's school", async () => {
    studentRepository.findByUserPk.mockResolvedValue(studentRow);
    departmentRepository.findByEmailDomain.mockResolvedValue([
      { pk: 1, schoolPk: 1, name: "전기전자컴퓨터공학부" },
      { pk: 2, schoolPk: 1, name: "기계공학부" },
    ]);

    await expect(service.getDepartments(userPk)).resolves.toEqual({
      departments: [
        { id: 1, name: "전기전자컴퓨터공학부" },
        { id: 2, name: "기계공학부" },
      ],
    });
    expect(departmentRepository.findByEmailDomain).toHaveBeenCalledWith(
      "gm.gist.ac.kr",
    );
  });

  it("getDepartments returns 403 when the student row is gone (type changed)", async () => {
    studentRepository.findByUserPk.mockResolvedValue(null);

    await expect(service.getDepartments(userPk)).rejects.toThrow(
      new ForbiddenException("User type not allowed"),
    );
  });

  it("getInterests returns the fixed interest list", () => {
    interestService.getNames.mockReturnValue(["반도체", "소프트웨어"]);

    expect(service.getInterests()).toEqual({
      interests: ["반도체", "소프트웨어"],
    });
  });

  describe("saveInfo", () => {
    it("inserts version 1, saves the contact and completes signup with new tokens", async () => {
      await expect(service.saveInfo(userPk, request())).resolves.toEqual({
        result: "OK",
        access_token: "access",
        refresh_token: "refresh",
      });

      expect(userRepository.findByPkForUpdate).toHaveBeenCalledWith(userPk, tx);
      expect(departmentRepository.findByPkAndEmailDomain).toHaveBeenCalledWith(
        1,
        "gm.gist.ac.kr",
        tx,
      );
      expect(profileRepository.insert).toHaveBeenCalledWith(
        {
          studentPk: studentRow.pk,
          version: 1,
          departmentPk: 1,
          interests: ["반도체", "소프트웨어"],
          activities: [],
        },
        tx,
      );
      expect(attachmentRepository.insertMany).toHaveBeenCalledWith(
        "new-profile",
        [
          {
            kind: "portfolio",
            source: "link",
            url: "https://portfolio.example.com",
            fileName: null,
          },
        ],
        tx,
      );
      expect(contactRepository.upsert).toHaveBeenCalledWith(
        {
          userPk,
          emailEnabled: true,
          kakaoEnabled: false,
          email: "gildong@gm.gist.ac.kr",
          phone: null,
        },
        tx,
      );
      expect(userRepository.activate).toHaveBeenCalledWith(userPk, tx);
      expect(authService.issueTokens).toHaveBeenCalledWith(
        expect.objectContaining({ pk: userPk, status: "active" }),
        tx,
      );
    });

    it("does not insert a new version or issue tokens when an active student changes only the contact", async () => {
      userRepository.findByPkForUpdate.mockResolvedValue(
        user({ status: "active" }),
      );
      studentRepository.findByUserPkWithLatestProfile.mockResolvedValue({
        student: studentRow,
        latest,
      });

      await expect(
        service.saveInfo(
          userPk,
          request({
            activities: [],
            contact: {
              email_enabled: false,
              kakao_enabled: true,
              email: "gildong@gm.gist.ac.kr",
              phone: "01012345678",
            },
          }),
        ),
      ).resolves.toEqual({ result: "OK" });

      expect(profileRepository.insert).not.toHaveBeenCalled();
      expect(attachmentRepository.insertMany).not.toHaveBeenCalled();
      // 끈 방법(email)의 값은 보내도 null로 저장
      expect(contactRepository.upsert).toHaveBeenCalledWith(
        {
          userPk,
          emailEnabled: false,
          kakaoEnabled: true,
          email: null,
          phone: "01012345678",
        },
        tx,
      );
      expect(userRepository.activate).not.toHaveBeenCalled();
      expect(authService.issueTokens).not.toHaveBeenCalled();
    });

    describe("file attachments", () => {
      const tempKey = `tmp/attachment/${userPk}/aaaa.pdf`;
      const finalKey = `attachment/${userPk}/aaaa.pdf`;
      const fileRequest = (key: string, file_name = "이력서.pdf") =>
        request({
          attachments: [{ kind: "cv", source: "file", key, file_name }],
        });
      const latestWithFile: typeof latest = {
        ...latest,
        attachments: [
          {
            kind: "cv",
            source: "file",
            url: finalKey,
            fileName: "이력서.pdf",
          },
        ],
      };

      it("confirms a new upload before the transaction and stores the final key", async () => {
        const order: string[] = [];
        fileService.confirmUpload.mockImplementation(() => {
          order.push("confirm");
          return Promise.resolve(finalKey);
        });
        userRepository.findByPkForUpdate.mockImplementation(() => {
          order.push("transaction");
          return Promise.resolve(user());
        });

        await service.saveInfo(userPk, fileRequest(tempKey));

        expect(order).toEqual(["confirm", "transaction"]);
        expect(fileService.confirmUpload).toHaveBeenCalledWith(
          userPk,
          "attachment",
          tempKey,
        );
        expect(attachmentRepository.insertMany).toHaveBeenCalledWith(
          "new-profile",
          [
            {
              kind: "cv",
              source: "file",
              url: finalKey,
              fileName: "이력서.pdf",
            },
          ],
          tx,
        );
      });

      it("keeps an existing file without a new version when its key is sent back", async () => {
        studentRepository.findByUserPkWithLatestProfile.mockResolvedValue({
          student: studentRow,
          latest: latestWithFile,
        });

        await service.saveInfo(userPk, fileRequest(finalKey));

        expect(fileService.confirmUpload).not.toHaveBeenCalled();
        expect(profileRepository.insert).not.toHaveBeenCalled();
      });

      it("inserts a new version when only the file name changes", async () => {
        studentRepository.findByUserPkWithLatestProfile.mockResolvedValue({
          student: studentRow,
          latest: latestWithFile,
        });

        await service.saveInfo(userPk, fileRequest(finalKey, "새이름.pdf"));

        expect(profileRepository.insert).toHaveBeenCalled();
      });

      it.each([
        ["another user's temp key", "tmp/attachment/other-user/aaaa.pdf"],
        ["another user's final key", "attachment/other-user/aaaa.pdf"],
        ["another directory", `tmp/business-card/${userPk}/aaaa.jpg`],
        ["an arbitrary key", "../etc/passwd"],
      ])("returns 400 for %s before touching S3", async (_, key) => {
        await expect(
          service.saveInfo(userPk, fileRequest(key)),
        ).rejects.toThrow(new BadRequestException("Invalid file key"));

        expect(fileService.confirmUpload).not.toHaveBeenCalled();
        expect(userRepository.findByPkForUpdate).not.toHaveBeenCalled();
      });

      it("returns 400 for my own final key that is not in my current attachments", async () => {
        await expect(
          service.saveInfo(userPk, fileRequest(finalKey)),
        ).rejects.toThrow(new BadRequestException("Invalid file key"));

        expect(profileRepository.insert).not.toHaveBeenCalled();
      });

      it("returns 400 when the same key is sent twice", async () => {
        const dup = { kind: "cv", source: "file", key: tempKey } as const;
        await expect(
          service.saveInfo(
            userPk,
            request({
              attachments: [
                { ...dup, file_name: "a.pdf" },
                { ...dup, kind: "portfolio", file_name: "b.pdf" },
              ],
            }),
          ),
        ).rejects.toThrow(new BadRequestException("Duplicate file key"));

        expect(fileService.confirmUpload).not.toHaveBeenCalled();
      });

      it.each([
        [
          "a link with a key",
          { kind: "cv", source: "link", url: "https://a.com", key: tempKey },
        ],
        [
          "a link with a file name",
          {
            kind: "cv",
            source: "link",
            url: "https://a.com",
            file_name: "a.pdf",
          },
        ],
      ])("returns 400 for %s", async (_, attachment) => {
        await expect(
          service.saveInfo(
            userPk,
            request({
              attachments: [
                attachment as SaveStudentInfoRequestDto["attachments"] extends
                  | (infer T)[]
                  | undefined
                  ? T
                  : never,
              ],
            }),
          ),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(fileService.confirmUpload).not.toHaveBeenCalled();
      });

      it("saves links and files together, in order", async () => {
        fileService.confirmUpload.mockResolvedValue(finalKey);

        await service.saveInfo(
          userPk,
          request({
            attachments: [
              { kind: "portfolio", source: "link", url: "https://a.com" },
              { kind: "cv", source: "file", key: tempKey, file_name: "a.pdf" },
            ],
          }),
        );

        expect(attachmentRepository.insertMany).toHaveBeenCalledWith(
          "new-profile",
          [
            {
              kind: "portfolio",
              source: "link",
              url: "https://a.com",
              fileName: null,
            },
            { kind: "cv", source: "file", url: finalKey, fileName: "a.pdf" },
          ],
          tx,
        );
      });

      it("keeps the confirmed file when the transaction fails", async () => {
        fileService.confirmUpload.mockResolvedValue(finalKey);
        contactRepository.upsert.mockRejectedValueOnce(new Error("db down"));

        await expect(
          service.saveInfo(userPk, fileRequest(tempKey)),
        ).rejects.toThrow("db down");

        expect(fileService.confirmUpload).toHaveBeenCalled();
        expect(fileService.deleteFile).not.toHaveBeenCalled();
      });

      it("does not move new files when the department is invalid", async () => {
        departmentRepository.findByPkAndEmailDomain.mockResolvedValue(null);

        await expect(
          service.saveInfo(userPk, fileRequest(tempKey)),
        ).rejects.toThrow(
          new BadRequestException("Department does not belong to your school"),
        );

        expect(fileService.confirmUpload).not.toHaveBeenCalled();
      });

      it("does not move new files when a reused key is not in my current attachments", async () => {
        await expect(
          service.saveInfo(
            userPk,
            request({
              attachments: [
                {
                  kind: "cv",
                  source: "file",
                  key: tempKey,
                  file_name: "a.pdf",
                },
                {
                  kind: "portfolio",
                  source: "file",
                  key: `attachment/${userPk}/gone.pdf`,
                  file_name: "b.pdf",
                },
              ],
            }),
          ),
        ).rejects.toThrow(new BadRequestException("Invalid file key"));

        expect(fileService.confirmUpload).not.toHaveBeenCalled();
      });

      it("accepts the attachments of the info response sent back as they are", async () => {
        studentRepository.findByUserPkWithLatestProfile.mockResolvedValue({
          student: studentRow,
          latest: {
            ...latest,
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
                url: finalKey,
                fileName: "이력서.pdf",
              },
            ],
          },
        });

        await service.saveInfo(
          userPk,
          request({
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
                key: finalKey,
              },
            ] as unknown as SaveStudentInfoRequestDto["attachments"],
          }),
        );

        expect(fileService.confirmUpload).not.toHaveBeenCalled();
        expect(profileRepository.insert).not.toHaveBeenCalled();
      });

      it("returns the confirmUpload error and does not open the transaction", async () => {
        fileService.confirmUpload.mockRejectedValue(
          new BadRequestException("File not uploaded"),
        );

        await expect(
          service.saveInfo(userPk, fileRequest(tempKey)),
        ).rejects.toThrow(new BadRequestException("File not uploaded"));

        expect(userRepository.findByPkForUpdate).not.toHaveBeenCalled();
      });
    });

    it.each([
      ["department", { department_id: 2 }],
      ["interest order", { interests: ["소프트웨어", "반도체"] }],
      ["activities", { activities: ["학부 연구생"] }],
      ["attachments", { attachments: [] }],
    ])("inserts the next version when the %s changes", async (_, overrides) => {
      studentRepository.findByUserPkWithLatestProfile.mockResolvedValue({
        student: studentRow,
        latest,
      });

      await service.saveInfo(userPk, request(overrides));

      expect(profileRepository.insert).toHaveBeenCalledWith(
        expect.objectContaining({ version: 3 }),
        tx,
      );
    });

    it.each([
      [
        "no contact method is chosen",
        { email_enabled: false, kakao_enabled: false },
        "At least one contact method is required",
      ],
      [
        "email is enabled without an address",
        { email_enabled: true, kakao_enabled: false },
        "Contact email is required",
      ],
      [
        "kakao is enabled without a phone",
        { email_enabled: false, kakao_enabled: true },
        "Contact phone is required",
      ],
    ])("returns 400 when %s", async (_, contact, message) => {
      await expect(
        service.saveInfo(userPk, request({ contact })),
      ).rejects.toThrow(new BadRequestException(message));
      expect(userRepository.findByPkForUpdate).not.toHaveBeenCalled();
    });

    it("requires a name on the first save, and stores it", async () => {
      userRepository.findByPkForUpdate.mockResolvedValue(user({ name: null }));

      await expect(service.saveInfo(userPk, request())).rejects.toThrow(
        new BadRequestException("Name is required"),
      );

      await service.saveInfo(userPk, request({ name: "홍길동" }));
      expect(userRepository.fillName).toHaveBeenCalledWith(
        userPk,
        "홍길동",
        tx,
      );
    });

    it("ignores the name once it is set", async () => {
      await service.saveInfo(userPk, request({ name: "다른이름" }));

      expect(userRepository.fillName).not.toHaveBeenCalled();
    });

    it("returns 400 for a department of another school", async () => {
      departmentRepository.findByPkAndEmailDomain.mockResolvedValue(null);

      await expect(
        service.saveInfo(userPk, request({ department_id: 99 })),
      ).rejects.toThrow(
        new BadRequestException("Department does not belong to your school"),
      );
      expect(profileRepository.insert).not.toHaveBeenCalled();
      expect(userRepository.activate).not.toHaveBeenCalled();
    });

    describe("inactive department", () => {
      beforeEach(() => {
        departmentRepository.findByPkAndEmailDomain.mockResolvedValue({
          pk: 1,
          schoolPk: 1,
          name: "전기전자컴퓨터공학부",
          isActive: false,
        });
      });

      it("returns 400 when newly choosing it", async () => {
        await expect(service.saveInfo(userPk, request())).rejects.toThrow(
          new BadRequestException("Department is no longer available"),
        );
        expect(profileRepository.insert).not.toHaveBeenCalled();
      });

      it("returns 400 when the current profile has another department", async () => {
        studentRepository.findByUserPkWithLatestProfile.mockResolvedValue({
          student: studentRow,
          latest: {
            ...latest,
            profile: { ...latest.profile, departmentPk: 2 },
          },
        });

        await expect(service.saveInfo(userPk, request())).rejects.toThrow(
          new BadRequestException("Department is no longer available"),
        );
        expect(profileRepository.insert).not.toHaveBeenCalled();
      });

      it("allows keeping it while changing other fields", async () => {
        studentRepository.findByUserPkWithLatestProfile.mockResolvedValue({
          student: studentRow,
          latest,
        });

        await service.saveInfo(userPk, request({ interests: ["반도체"] }));

        expect(profileRepository.insert).toHaveBeenCalledWith(
          expect.objectContaining({ departmentPk: 1, version: 3 }),
          tx,
        );
      });
    });

    it("returns 403 when the user switched to graduated after the guard", async () => {
      studentRepository.findByUserPkWithLatestProfile.mockResolvedValue(null);

      await expect(service.saveInfo(userPk, request())).rejects.toThrow(
        new ForbiddenException("User type not allowed"),
      );
      expect(contactRepository.upsert).not.toHaveBeenCalled();
    });

    it("returns 401 when the user withdrew right after the guard", async () => {
      userRepository.findByPkForUpdate.mockResolvedValue(null);

      await expect(service.saveInfo(userPk, request())).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
