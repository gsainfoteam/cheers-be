import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { FileService } from "./file.service";

jest.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: jest.fn(),
}));

const config: Record<string, string> = {
  AWS_S3_REGION: "ap-northeast-2",
  AWS_S3_BUCKET_NAME: "test-bucket",
};

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

  it("deletes files", async () => {
    await service.deleteFiles(["a.jpg", "b.png"]);

    expect(send).toHaveBeenCalledTimes(2);
    const keys = send.mock.calls.map(
      ([command]) => (command as DeleteObjectCommand).input.Key,
    );
    expect(keys).toEqual(["a.jpg", "b.png"]);
  });

  it("listFiles passes the prefix and token and returns the next token", async () => {
    const lastModified = new Date("2026-10-01T00:00:00Z");
    send.mockResolvedValue({
      Contents: [{ Key: "attachment/u/a.pdf", LastModified: lastModified }],
      IsTruncated: true,
      NextContinuationToken: "next",
    } as never);

    const page = await service.listFiles("attachment/", "token");

    const input = (send.mock.calls[0][0] as ListObjectsV2Command).input;
    expect(input).toEqual({
      Bucket: "test-bucket",
      Prefix: "attachment/",
      ContinuationToken: "token",
    });
    expect(page).toEqual({
      files: [{ key: "attachment/u/a.pdf", lastModified }],
      nextToken: "next",
    });
  });

  it("listFiles returns no token on the last page and handles an empty prefix", async () => {
    send.mockResolvedValue({
      IsTruncated: false,
      NextContinuationToken: "ignored",
    } as never);

    await expect(service.listFiles("attachment/")).resolves.toEqual({
      files: [],
      nextToken: undefined,
    });
  });

  it("listFiles throws when S3 fails", async () => {
    send.mockRejectedValue(new Error("S3 down"));

    await expect(service.listFiles("attachment/")).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it("deleteFileQuietly deletes the file", async () => {
    await service.deleteFileQuietly("business-card/a.jpg");

    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0][0] as DeleteObjectCommand).input.Key).toBe(
      "business-card/a.jpg",
    );
  });

  it("deleteFileQuietly does not throw when S3 fails", async () => {
    send.mockRejectedValue(new Error("S3 down"));

    await expect(
      service.deleteFileQuietly("business-card/a.jpg"),
    ).resolves.toBeUndefined();
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
});
