import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

type StoredObject = { body: Buffer; lastModified: Date };

// FileService의 로직은 그대로 두고 S3Client.send만 메모리 저장소로 바꿈. 실제 버킷으로 나가는 경로가 없음.
// presigned URL 발급은 send를 거치지 않는 로컬 서명이라 그대로 동작
export class FakeS3 {
  readonly objects = new Map<string, StoredObject>();
  readonly deletedKeys: string[] = [];
  // DeleteObject가 불릴 때 실행. "커밋 뒤에 지우는지" 확인용
  onDelete: ((key: string) => Promise<void>) | null = null;
  private spy: jest.SpyInstance | null = null;

  install(): void {
    this.spy = jest
      .spyOn(S3Client.prototype, "send")
      .mockImplementation((command: unknown) => this.handle(command));
  }

  uninstall(): void {
    this.spy?.mockRestore();
    this.spy = null;
  }

  reset(): void {
    this.objects.clear();
    this.deletedKeys.length = 0;
    this.onDelete = null;
  }

  // 준비 단계의 삭제(confirmUpload의 tmp 파일)를 빼고, 검사할 작업의 삭제만 남기려고 호출
  clearDeleteLog(): void {
    this.deletedKeys.length = 0;
  }

  // 브라우저가 presigned URL로 올린 것을 대신함
  put(key: string, body: Buffer, lastModified: Date = new Date()): void {
    this.objects.set(key, { body, lastModified });
  }

  setLastModified(key: string, lastModified: Date): void {
    const object = this.objects.get(key);
    if (!object) throw new Error(`FakeS3: no such object ${key}`);
    object.lastModified = lastModified;
  }

  private async handle(command: unknown): Promise<unknown> {
    if (command instanceof HeadObjectCommand) {
      const object = this.objects.get(command.input.Key ?? "");
      if (!object) throw notFound();
      return { ContentLength: object.body.length };
    }
    if (command instanceof GetObjectCommand) {
      const object = this.objects.get(command.input.Key ?? "");
      if (!object) throw notFound();
      return {
        Body: { transformToByteArray: async () => new Uint8Array(object.body) },
      };
    }
    if (command instanceof CopyObjectCommand) {
      const bucketPrefix = `${command.input.Bucket}/`;
      const source = (command.input.CopySource ?? "").slice(
        bucketPrefix.length,
      );
      const object = this.objects.get(source);
      if (!object) throw notFound();
      this.objects.set(command.input.Key ?? "", {
        body: object.body,
        lastModified: new Date(),
      });
      return {};
    }
    if (command instanceof DeleteObjectCommand) {
      const key = command.input.Key ?? "";
      await this.onDelete?.(key);
      this.objects.delete(key);
      this.deletedKeys.push(key);
      return {};
    }
    if (command instanceof ListObjectsV2Command) {
      const prefix = command.input.Prefix ?? "";
      return {
        Contents: [...this.objects.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([Key, { lastModified }]) => ({
            Key,
            LastModified: lastModified,
          })),
        IsTruncated: false,
      };
    }
    throw new Error(
      `FakeS3: unsupported command ${(command as object).constructor.name}`,
    );
  }
}

const notFound = () =>
  new S3ServiceException({
    name: "NotFound",
    $fault: "client",
    $metadata: { httpStatusCode: 404 },
    message: "Not Found",
  });
