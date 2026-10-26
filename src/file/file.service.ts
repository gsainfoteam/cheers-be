import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MAX_ORIGINAL_NAME_LENGTH } from "./file.constants";
import { detectFileMimeType } from "./file.utils";

const DEFAULT_PRESIGNED_URL_EXPIRES_IN = 600;

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly presignedUrlExpiresIn: number;
  constructor(private readonly configService: ConfigService) {
    this.s3Client = new S3Client({
      region: configService.getOrThrow<string>("AWS_S3_REGION"),
    });
    this.bucketName = configService.getOrThrow<string>("AWS_S3_BUCKET_NAME");
    this.presignedUrlExpiresIn = Number(
      configService.get<string>("S3_PRESIGNED_URL_EXPIRES_IN") ??
        DEFAULT_PRESIGNED_URL_EXPIRES_IN,
    );
  }

  /**
   * this method uploads a file to the S3 bucket
   * the caller saves the key in the same request and deletes the file if that fails
   * @param file Express.Multer.File
   * @param key string
   * @returns string
   */
  async uploadFile(file: Express.Multer.File, key: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: file.buffer,
      // 클라이언트가 보낸 타입 대신 내용에서 감지한 타입으로 저장
      ContentType: detectFileMimeType(file.buffer) ?? file.mimetype,
      Metadata: {
        // 코드 포인트 단위로 잘라 서로게이트 쌍이 깨지지 않게 함
        originalName: encodeURIComponent(
          Array.from(file.originalname)
            .slice(0, MAX_ORIGINAL_NAME_LENGTH)
            .join(""),
        ),
      },
    });

    await this.s3Client.send(command).catch((err) => {
      this.logger.error(err);
      throw new InternalServerErrorException();
    });
    return key;
  }

  /**
   * this method deletes a file from the S3 bucket
   * @param key string
   */
  async deleteFile(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    await this.s3Client.send(command).catch((err) => {
      this.logger.error(err);
      throw new InternalServerErrorException();
    });
  }

  async deleteFiles(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.deleteFile(key)));
  }

  /**
   * this method creates a presigned URL to read a file in the private bucket
   * @param key string
   * @param expiresIn number seconds until the URL expires
   * @returns string
   */
  async getPresignedUrl(
    key: string,
    expiresIn: number = this.presignedUrlExpiresIn,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    return getSignedUrl(this.s3Client, command, { expiresIn }).catch((err) => {
      this.logger.error(err);
      throw new InternalServerErrorException();
    });
  }
}
