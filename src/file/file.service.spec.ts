import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  PutObjectTaggingCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { FileDirectory } from "./file.constants";
import { FileService } from "./file.service";
import { generateFileKey } from "./file.utils";

jest.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: jest.fn(),
}));

const config: Record<string, string> = {
  AWS_S3_REGION: "ap-northeast-2",
  AWS_S3_BUCKET_NAME: "test-bucket",
};

const file = {
  buffer: Buffer.from("image"),
  mimetype: "image/jpeg",
  originalname: "명함.jpg",
} as Express.Multer.File;

describe("FileService", () => {
  let service: FileService;
  let send: jest.SpyInstance;

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

  it("uploads a file tagged for expiration and returns the key", async () => {
    const key = await service.uploadFile(file, "business-card/a.jpg");

    expect(key).toBe("business-card/a.jpg");
    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: "test-bucket",
      Key: "business-card/a.jpg",
      Body: file.buffer,
      ContentType: "image/jpeg",
      Tagging: "expiration=true",
      Metadata: { originalName: encodeURIComponent("명함.jpg") },
    });
  });

  it("validates a file by setting the expiration tag to false", async () => {
    await service.validateFile("business-card/a.jpg");

    const command = send.mock.calls[0][0] as PutObjectTaggingCommand;
    expect(command).toBeInstanceOf(PutObjectTaggingCommand);
    expect(command.input.Tagging).toEqual({
      TagSet: [{ Key: "expiration", Value: "false" }],
    });
  });

  it("deletes files", async () => {
    await service.deleteFiles(["a.jpg", "b.png"]);

    expect(send).toHaveBeenCalledTimes(2);
    const keys = send.mock.calls.map(
      ([command]) => (command as DeleteObjectCommand).input.Key,
    );
    expect(keys).toEqual(["a.jpg", "b.png"]);
  });

  it("creates a presigned URL with the default expiry", async () => {
    (getSignedUrl as jest.Mock).mockResolvedValue("https://signed");

    const url = await service.getPresignedUrl("business-card/a.jpg");

    expect(url).toBe("https://signed");
    const [, command, options] = (getSignedUrl as jest.Mock).mock.calls[0];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toEqual({
      Bucket: "test-bucket",
      Key: "business-card/a.jpg",
    });
    expect(options).toEqual({ expiresIn: 600 });
  });

  it("wraps S3 errors as InternalServerErrorException", async () => {
    send.mockRejectedValue(new Error("AccessDenied"));

    await expect(service.uploadFile(file, "a.jpg")).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});

describe("generateFileKey", () => {
  it("builds a key under the directory with a lowercased extension", () => {
    expect(generateFileKey(FileDirectory.BUSINESS_CARD, "Card.JPG")).toMatch(
      /^business-card\/[0-9a-f-]{36}\.jpg$/,
    );
  });
});
