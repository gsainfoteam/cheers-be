import { BadRequestException } from "@nestjs/common";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import {
  createFileValidationPipe,
  FileContentValidator,
} from "./file-content.validator";
import { BUSINESS_CARD_FILE_POLICY, FileDirectory } from "./file.constants";
import { FileService } from "./file.service";
import { detectFileMimeType, generateFileKey } from "./file.utils";

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

const upload = (buffer: Buffer, mimetype = "image/png") =>
  ({ buffer, mimetype, originalname: "card.png" }) as Express.Multer.File;

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

describe("FileContentValidator", () => {
  const validator = new FileContentValidator(BUSINESS_CARD_FILE_POLICY);

  it("accepts an allowed image even if the client sent another image type", () => {
    expect(validator.isValid(upload(jpeg, "image/png"))).toBe(true);
  });

  it.each([
    ["html sent as image/png", upload(html)],
    ["svg sent as image/png", upload(svg)],
    ["file without buffer", { mimetype: "image/png" } as Express.Multer.File],
    ["missing file", undefined],
  ])("rejects %s", (_, file) => {
    expect(validator.isValid(file)).toBe(false);
  });

  it("makes the pipe return 400 for disguised content and a missing file", async () => {
    const pipe = createFileValidationPipe(BUSINESS_CARD_FILE_POLICY);

    await expect(pipe.transform(upload(html))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(pipe.transform(undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(pipe.transform(upload(png))).resolves.toBeDefined();
  });
});

describe("generateFileKey extension", () => {
  it("uses the detected type, never the original file name", () => {
    expect(generateFileKey(FileDirectory.BUSINESS_CARD, "image/heic")).toMatch(
      /^business-card\/[0-9a-f-]{36}\.heic$/,
    );
    expect(generateFileKey(FileDirectory.BUSINESS_CARD, "text/html")).toMatch(
      /^business-card\/[0-9a-f-]{36}$/,
    );
  });
});

describe("FileService.uploadFile content metadata", () => {
  let service: FileService;
  let send: jest.SpyInstance;

  beforeEach(async () => {
    send = jest
      .spyOn(S3Client.prototype, "send")
      .mockResolvedValue({} as never);
    const config: Record<string, string> = {
      AWS_S3_REGION: "ap-northeast-2",
      AWS_S3_BUCKET_NAME: "test-bucket",
    };
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

  it("stores the detected content type instead of the client's", async () => {
    await service.uploadFile(upload(jpeg, "image/png"), "business-card/a.jpg");

    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(command.input.ContentType).toBe("image/jpeg");
  });

  it("keeps only the first 100 characters of a long original name without breaking emoji", async () => {
    const longName = "😀".repeat(150) + ".png";

    await service.uploadFile(
      { ...upload(png), originalname: longName },
      "business-card/a.png",
    );

    const command = send.mock.calls[0][0] as PutObjectCommand;
    const stored = decodeURIComponent(command.input.Metadata!.originalName);
    expect(Array.from(stored)).toHaveLength(100);
    expect(stored).toBe("😀".repeat(100));
  });
});
