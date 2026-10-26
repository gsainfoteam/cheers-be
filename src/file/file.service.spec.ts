import {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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
