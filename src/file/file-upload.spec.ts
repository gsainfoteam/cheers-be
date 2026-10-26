import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  PayloadTooLargeException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { UserContext } from "@src/auth/context/user-context";
import { FileDirectory, FilePurpose } from "./file.constants";
import { FileService } from "./file.service";
import {
  detectFileMimeType,
  generateTempFileKey,
  isUserTempFileKey,
  toConfirmedFileKey,
} from "./file.utils";

const config: Record<string, string> = {
  AWS_S3_REGION: "ap-northeast-2",
  AWS_S3_BUCKET_NAME: "test-bucket",
};

const USER_PK = "11111111-1111-1111-1111-111111111111";
const graduated = new UserContext(USER_PK, "graduated", "pending");
const student = new UserContext(USER_PK, "student", "pending");
const TEMP_KEY = `tmp/business-card/${USER_PK}/a.jpg`;
const MB = 1024 * 1024;

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
// ISO BMFF: 4바이트 box 크기 + "ftyp" + major brand
const ftyp = (brand: string) =>
  Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from(`ftyp${brand}`),
  ]);
const html = Buffer.from("<html><script>alert(1)</script></html>");
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

// GetObject Range 응답
const body = (content: Buffer) => ({
  Body: { transformToByteArray: async () => new Uint8Array(content) },
});

const notFound = () =>
  new S3ServiceException({
    name: "NotFound",
    $fault: "client",
    $metadata: { httpStatusCode: 404 },
  });

describe("FileService upload", () => {
  let service: FileService;
  let send: jest.SpyInstance;

  beforeAll(() => {
    // presigned URL은 오프라인으로 서명되므로 가짜 자격증명으로 실제 URL을 만들어 검사
    process.env.AWS_ACCESS_KEY_ID = "AKIDTEST";
    process.env.AWS_SECRET_ACCESS_KEY = "secret";
  });

  afterAll(() => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
  });

  beforeEach(async () => {
    send = jest
      .spyOn(S3Client.prototype, "send")
      .mockResolvedValue({} as never);
    const module = await Test.createTestingModule({
      providers: [
        FileService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => config[key],
            getOrThrow: (key: string) => config[key],
          },
        },
      ],
    }).compile();
    service = module.get(FileService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe("createUploadUrl", () => {
    it("signs content-type and content-length into a PUT URL under tmp/", async () => {
      const result = await service.createUploadUrl(
        graduated,
        FilePurpose.BUSINESS_CARD,
        "image/jpeg",
        1234,
      );

      expect(result.key).toMatch(
        new RegExp(`^tmp/business-card/${USER_PK}/[0-9a-f-]{36}\\.jpg$`),
      );
      expect(result.headers).toEqual({ "Content-Type": "image/jpeg" });
      expect(result.expiresIn).toBe(300);

      const url = new URL(result.url);
      expect(url.host).toBe("test-bucket.s3.ap-northeast-2.amazonaws.com");
      expect(url.pathname).toBe(`/${result.key}`);
      expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
        "content-length;content-type;host",
      );
      expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
      // 빈 body checksum이 서명되면 실제 업로드가 실패함
      expect(url.searchParams.has("x-amz-checksum-crc32")).toBe(false);
    });

    it("rejects a user type the purpose does not allow", async () => {
      await expect(
        service.createUploadUrl(
          student,
          FilePurpose.BUSINESS_CARD,
          "image/jpeg",
          1234,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("rejects an unsupported content type", async () => {
      await expect(
        service.createUploadUrl(
          graduated,
          FilePurpose.BUSINESS_CARD,
          "application/pdf",
          1234,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects a file larger than the policy", async () => {
      await expect(
        service.createUploadUrl(
          graduated,
          FilePurpose.BUSINESS_CARD,
          "image/png",
          10 * MB + 1,
        ),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
    });
  });

  describe("confirmUpload", () => {
    it("moves a valid upload out of tmp/ and returns the confirmed key", async () => {
      send
        .mockResolvedValueOnce({
          ContentLength: MB,
          ContentType: "image/jpeg",
        } as never)
        .mockResolvedValueOnce(body(jpeg) as never);

      const key = await service.confirmUpload(
        USER_PK,
        FilePurpose.BUSINESS_CARD,
        TEMP_KEY,
      );

      expect(key).toBe(`business-card/${USER_PK}/a.jpg`);
      const [head, get, copy, del] = send.mock.calls.map(
        ([command]) => command,
      );
      expect(head).toBeInstanceOf(HeadObjectCommand);
      expect(get).toBeInstanceOf(GetObjectCommand);
      expect((get as GetObjectCommand).input.Range).toBe("bytes=0-11");
      expect(copy).toBeInstanceOf(CopyObjectCommand);
      expect((copy as CopyObjectCommand).input).toEqual({
        Bucket: "test-bucket",
        CopySource: `test-bucket/${TEMP_KEY}`,
        Key: key,
        ContentType: "image/jpeg",
        MetadataDirective: "REPLACE",
      });
      expect(del).toBeInstanceOf(DeleteObjectCommand);
      expect((del as DeleteObjectCommand).input.Key).toBe(TEMP_KEY);
    });

    it("stores the detected type and extension when the content differs from the requested type", async () => {
      send
        .mockResolvedValueOnce({
          ContentLength: MB,
          ContentType: "image/jpeg",
        } as never)
        .mockResolvedValueOnce(body(png) as never);

      const key = await service.confirmUpload(
        USER_PK,
        FilePurpose.BUSINESS_CARD,
        TEMP_KEY,
      );

      expect(key).toBe(`business-card/${USER_PK}/a.png`);
      const copy = send.mock.calls[2][0] as CopyObjectCommand;
      expect(copy.input.ContentType).toBe("image/png");
    });

    it("rejects a key issued to another user without touching S3", async () => {
      await expect(
        service.confirmUpload(
          "22222222-2222-2222-2222-222222222222",
          FilePurpose.BUSINESS_CARD,
          TEMP_KEY,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(send).not.toHaveBeenCalled();
    });

    it("rejects a key that was never uploaded", async () => {
      send.mockRejectedValueOnce(notFound());

      await expect(
        service.confirmUpload(USER_PK, FilePurpose.BUSINESS_CARD, TEMP_KEY),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("deletes the upload and rejects when it is too large, without reading it", async () => {
      send.mockResolvedValueOnce({
        ContentLength: 10 * MB + 1,
        ContentType: "image/jpeg",
      } as never);

      await expect(
        service.confirmUpload(USER_PK, FilePurpose.BUSINESS_CARD, TEMP_KEY),
      ).rejects.toBeInstanceOf(BadRequestException);
      const del = send.mock.calls[1][0] as DeleteObjectCommand;
      expect(del).toBeInstanceOf(DeleteObjectCommand);
      expect(del.input.Key).toBe(TEMP_KEY);
      expect(send).toHaveBeenCalledTimes(2);
    });

    it.each([
      ["html uploaded as image/jpeg", html],
      ["svg uploaded as image/jpeg", svg],
      ["empty", Buffer.alloc(0)],
    ])(
      "deletes the upload and rejects when the content is %s",
      async (_, content) => {
        send
          .mockResolvedValueOnce({
            ContentLength: MB,
            ContentType: "image/jpeg",
          } as never)
          .mockResolvedValueOnce(body(content) as never);

        await expect(
          service.confirmUpload(USER_PK, FilePurpose.BUSINESS_CARD, TEMP_KEY),
        ).rejects.toBeInstanceOf(BadRequestException);
        const del = send.mock.calls[2][0] as DeleteObjectCommand;
        expect(del).toBeInstanceOf(DeleteObjectCommand);
        expect(del.input.Key).toBe(TEMP_KEY);
        expect(send).toHaveBeenCalledTimes(3);
      },
    );

    it("wraps other S3 errors as InternalServerErrorException", async () => {
      send.mockRejectedValueOnce(new Error("AccessDenied"));

      await expect(
        service.confirmUpload(USER_PK, FilePurpose.BUSINESS_CARD, TEMP_KEY),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });
});

describe("file keys", () => {
  it("builds a temp key under the user's directory", () => {
    expect(
      generateTempFileKey(FileDirectory.BUSINESS_CARD, USER_PK, "png"),
    ).toMatch(new RegExp(`^tmp/business-card/${USER_PK}/[0-9a-f-]{36}\\.png$`));
  });

  it.each([
    [TEMP_KEY, true],
    [`business-card/${USER_PK}/a.jpg`, false],
    [`tmp/business-card/${USER_PK}/`, false],
    [`tmp/business-card/${USER_PK}/../other/a.jpg`, false],
    [`tmp/business-card/${USER_PK}x/a.jpg`, false],
  ])("checks the owner of %s", (key, expected) => {
    expect(isUserTempFileKey(FileDirectory.BUSINESS_CARD, USER_PK, key)).toBe(
      expected,
    );
  });

  it("strips tmp/ from a confirmed key and applies the detected extension", () => {
    expect(toConfirmedFileKey(TEMP_KEY, "jpg")).toBe(
      `business-card/${USER_PK}/a.jpg`,
    );
    expect(toConfirmedFileKey(TEMP_KEY, "png")).toBe(
      `business-card/${USER_PK}/a.png`,
    );
  });
});

describe("detectFileMimeType", () => {
  it.each([
    ["jpeg", jpeg, "image/jpeg"],
    ["png", png, "image/png"],
    ["heic", ftyp("heic"), "image/heic"],
    ["heix", ftyp("heix"), "image/heic"],
    ["mif1", ftyp("mif1"), "image/heif"],
  ])("detects %s", (_, buffer, expected) => {
    expect(detectFileMimeType(buffer)).toBe(expected);
  });

  it.each([
    ["html", html],
    ["svg", svg],
    ["mp4 (ftyp but not HEIF)", ftyp("isom")],
    ["too short", Buffer.from([0xff, 0xd8])],
    ["empty", Buffer.alloc(0)],
  ])("returns undefined for %s", (_, buffer) => {
    expect(detectFileMimeType(buffer)).toBeUndefined();
  });
});
