import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadObjectCommandOutput,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  PayloadTooLargeException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FILE_UPLOAD_POLICIES, FilePurpose } from "./file.constants";
import { UploadUrl } from "./file.types";
import {
  detectFileMimeType,
  FILE_SIGNATURE_LENGTH,
  generateTempFileKey,
  isUserTempFileKey,
  toConfirmedFileKey,
} from "./file.utils";

const DEFAULT_PRESIGNED_URL_EXPIRES_IN = 600;
const DEFAULT_UPLOAD_URL_EXPIRES_IN = 300;

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly presignedUrlExpiresIn: number;
  private readonly uploadUrlExpiresIn: number;
  constructor(private readonly configService: ConfigService) {
    this.s3Client = new S3Client({
      region: configService.getOrThrow<string>("AWS_S3_REGION"),
      // 기본값(WHEN_SUPPORTED)이면 presigned PUT에 빈 body의 checksum이 서명돼 실제 업로드가 실패함
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
    this.bucketName = configService.getOrThrow<string>("AWS_S3_BUCKET_NAME");
    this.presignedUrlExpiresIn = Number(
      configService.get<string>("S3_PRESIGNED_URL_EXPIRES_IN") ??
        DEFAULT_PRESIGNED_URL_EXPIRES_IN,
    );
    this.uploadUrlExpiresIn = Number(
      configService.get<string>("S3_UPLOAD_URL_EXPIRES_IN") ??
        DEFAULT_UPLOAD_URL_EXPIRES_IN,
    );
  }

  /**
   * this method creates a presigned PUT URL for the browser to upload a file directly
   * Content-Type and Content-Length are signed, so S3 rejects a different type or size
   * the file goes under tmp/ until confirmUpload is called
   * who may upload for each purpose is checked by the controller's guards
   * @param userPk string
   * @param purpose FilePurpose
   * @param contentType string
   * @param size number bytes
   * @returns UploadUrl
   */
  async createUploadUrl(
    userPk: string,
    purpose: FilePurpose,
    contentType: string,
    size: number,
  ): Promise<UploadUrl> {
    const policy = FILE_UPLOAD_POLICIES[purpose];
    const extension = policy.allowedContentTypes[contentType];
    if (!extension) {
      throw new BadRequestException(`Unsupported file type: ${contentType}`);
    }
    if (size > policy.maxSize) {
      throw new PayloadTooLargeException();
    }

    const key = generateTempFileKey(policy.directory, userPk, extension);
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
      ContentLength: size,
    });
    const url = await getSignedUrl(this.s3Client, command, {
      expiresIn: this.uploadUrlExpiresIn,
      signableHeaders: new Set(["content-type", "content-length"]),
    }).catch((err) => {
      this.logger.error(err);
      throw new InternalServerErrorException();
    });

    return {
      url,
      key,
      headers: { "Content-Type": contentType },
      expiresIn: this.uploadUrlExpiresIn,
    };
  }

  /**
   * this method confirms a file uploaded with createUploadUrl
   * it checks the owner, size and the actual content (magic numbers),
   * then moves the file out of tmp/ with the detected Content-Type
   * @param userPk string
   * @param purpose FilePurpose
   * @param tempKey string key returned by createUploadUrl
   * @returns string confirmed key to store in the DB
   */
  async confirmUpload(
    userPk: string,
    purpose: FilePurpose,
    tempKey: string,
  ): Promise<string> {
    const policy = FILE_UPLOAD_POLICIES[purpose];
    if (!isUserTempFileKey(policy.directory, userPk, tempKey)) {
      throw new BadRequestException("Invalid file key");
    }

    const head = await this.headFile(tempKey);
    if (!head) {
      throw new BadRequestException("File not uploaded");
    }
    // 서명된 Content-Type은 클라이언트가 고른 값이라, 실제 내용으로 다시 확인
    const contentType =
      (head.ContentLength ?? 0) <= policy.maxSize
        ? detectFileMimeType(await this.readFileSignature(tempKey))
        : undefined;
    const extension = contentType && policy.allowedContentTypes[contentType];
    if (!contentType || !extension) {
      await this.deleteFile(tempKey);
      throw new BadRequestException("Uploaded file does not match the policy");
    }

    const key = toConfirmedFileKey(tempKey, extension);
    const command = new CopyObjectCommand({
      Bucket: this.bucketName,
      CopySource: `${this.bucketName}/${tempKey}`,
      Key: key,
      ContentType: contentType,
      MetadataDirective: "REPLACE",
    });
    await this.s3Client.send(command).catch((err) => {
      this.logger.error(err);
      throw new InternalServerErrorException();
    });
    await this.deleteFile(tempKey);
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

  /**
   * this method deletes a file and only logs when it fails
   * use it after the DB no longer refers to the file (orphans are cleaned up by CRB-41)
   * @param key string
   */
  async deleteFileQuietly(key: string): Promise<void> {
    try {
      await this.deleteFile(key);
    } catch (e) {
      this.logger.error(
        `Failed to delete file ${key}: ${(e as Error).message}`,
      );
    }
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

  // 내용 판별용으로 앞부분만 읽음 (Range GET)
  private async readFileSignature(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Range: `bytes=0-${FILE_SIGNATURE_LENGTH - 1}`,
    });

    const output = await this.s3Client.send(command).catch((err) => {
      this.logger.error(err);
      throw new InternalServerErrorException();
    });
    return Buffer.from((await output.Body?.transformToByteArray()) ?? []);
  }

  // 없으면 null
  private async headFile(key: string): Promise<HeadObjectCommandOutput | null> {
    const command = new HeadObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    return this.s3Client.send(command).catch((err) => {
      if (
        err instanceof S3ServiceException &&
        err.$metadata.httpStatusCode === 404
      ) {
        return null;
      }
      this.logger.error(err);
      throw new InternalServerErrorException();
    });
  }
}
