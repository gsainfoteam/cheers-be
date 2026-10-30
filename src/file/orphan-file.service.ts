import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GraduatedRepository } from "@src/database/repository/graduated.repository";
import { StudentProfileAttachmentRepository } from "@src/database/repository/student-profile-attachment.repository";
import { FileDirectory } from "./file.constants";
import { FileService } from "./file.service";

// 확정 직후 DB 저장 전인 파일을 지우지 않기 위한 대기 시간. confirmUpload의 CopyObject가 LastModified를 새로 씀
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_DELETES = 1000;

export type OrphanFileCleanupResult = {
  scanned: number;
  orphans: number;
  deleted: number;
  failed: number;
};

// DB에서 참조하지 않는 S3 파일 정리. 목록 · DB 조회가 모두 성공한 뒤에만 지움
@Injectable()
export class OrphanFileService {
  private readonly logger = new Logger(OrphanFileService.name);
  private readonly deleteEnabled: boolean;
  private readonly maxDeletes: number;
  // 처리하는 prefix와 참조 조회. 디렉터리를 추가하면 조회 함수 없이는 컴파일되지 않음 (빠뜨리면 그 디렉터리 파일이 전부 고아로 보임)
  private readonly findReferencedKeys: Record<
    FileDirectory,
    (keys: string[]) => Promise<string[]>
  >;

  constructor(
    configService: ConfigService,
    private readonly fileService: FileService,
    graduatedRepository: GraduatedRepository,
    studentProfileAttachmentRepository: StudentProfileAttachmentRepository,
  ) {
    // 첫 배포 안전을 위해 명시적으로 켜야 지움. 꺼져 있으면 후보를 로그로만 남김
    this.deleteEnabled =
      configService.get<string>("S3_ORPHAN_DELETE_ENABLED")?.trim() === "true";

    const raw = configService.get<string>("S3_ORPHAN_MAX_DELETES")?.trim();
    const maxDeletes = raw ? Number(raw) : DEFAULT_MAX_DELETES;
    if (!Number.isInteger(maxDeletes) || maxDeletes <= 0) {
      throw new Error("S3_ORPHAN_MAX_DELETES must be a positive integer.");
    }
    this.maxDeletes = maxDeletes;

    this.findReferencedKeys = {
      [FileDirectory.BUSINESS_CARD]: (keys) =>
        graduatedRepository.findExistingBusinessCardKeys(keys),
      [FileDirectory.ATTACHMENT]: (keys) =>
        studentProfileAttachmentRepository.findExistingFileKeys(keys),
    };
  }

  async cleanup(now: Date = new Date()): Promise<OrphanFileCleanupResult> {
    const { scanned, orphanKeys } = await this.findOrphanKeys(
      new Date(now.getTime() - ORPHAN_MIN_AGE_MS),
    );

    if (!this.deleteEnabled) {
      for (const key of orphanKeys) {
        this.logger.log(`Dry run: orphan file ${key}`);
      }
      return { scanned, orphans: orphanKeys.length, deleted: 0, failed: 0 };
    }

    let deleted = 0;
    let failed = 0;
    for (const key of orphanKeys) {
      try {
        await this.fileService.deleteFile(key);
        this.logger.log(`Deleted orphan file ${key}`);
        deleted++;
      } catch (e) {
        // DB에 참조가 없으므로 다음 실행에서 다시 후보가 됨
        this.logger.error(
          `Failed to delete orphan file ${key}: ${(e as Error).message}`,
        );
        failed++;
      }
    }
    return { scanned, orphans: orphanKeys.length, deleted, failed };
  }

  private async findOrphanKeys(
    cutoff: Date,
  ): Promise<{ scanned: number; orphanKeys: string[] }> {
    let scanned = 0;
    const orphanKeys: string[] = [];

    for (const directory of Object.values(FileDirectory)) {
      let token: string | undefined;
      do {
        const page = await this.fileService.listFiles(`${directory}/`, token);
        token = page.nextToken;
        scanned += page.files.length;

        const oldKeys = page.files
          .filter((f) => f.lastModified && f.lastModified <= cutoff)
          .map((f) => f.key);
        const referenced = new Set(
          await this.findReferencedKeys[directory](oldKeys),
        );
        orphanKeys.push(...oldKeys.filter((key) => !referenced.has(key)));

        // DB와 버킷이 어긋난 설정이면 전부 고아로 보이므로, 일부만 지우지 않고 사람이 확인하게 함
        if (orphanKeys.length > this.maxDeletes) {
          throw new Error(
            `Too many orphan candidates (over ${this.maxDeletes}). Nothing was deleted.`,
          );
        }
      } while (token);
    }
    return { scanned, orphanKeys };
  }
}
