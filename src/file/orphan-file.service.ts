import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GraduatedRepository } from "@src/database/repository/graduated.repository";
import { StudentProfileAttachmentRepository } from "@src/database/repository/student-profile-attachment.repository";
import { SlackService } from "nestjs-slack";
import { FileDirectory } from "./file.constants";
import { FileService } from "./file.service";

// 확정 직후 DB 저장 전인 파일을 지우지 않기 위한 대기 시간. confirmUpload의 CopyObject가 LastModified를 새로 씀
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_DELETES = 1000;
const DEFAULT_MAX_RATIO = 0.5;
// 파일이 적을 때는 고아 몇 개만으로 비율이 커지므로 이 수부터 비율을 봄
const RATIO_CHECK_MIN_ORPHANS = 10;

export type OrphanFileCleanupResult = {
  scanned: number;
  orphans: number;
  deleted: number;
  failed: number;
  // DB와 버킷이 어긋난 것으로 보여 지우지 않음
  stopped: boolean;
};

type OrphanFileScan = {
  scanned: number;
  // 기준 시간이 지난 파일 수 (참조 여부와 상관없이)
  oldFiles: number;
  orphans: number;
  // 이번 실행에서 지울 key. 최대 maxDeletes개만 들고 있고 나머지는 다음 실행에서 지움
  deletableKeys: string[];
};

// DB에서 참조하지 않는 S3 파일 정리. 목록 · DB 조회가 모두 성공한 뒤에만 지움
@Injectable()
export class OrphanFileService {
  private readonly logger = new Logger(OrphanFileService.name);
  private readonly deleteEnabled: boolean;
  private readonly maxDeletes: number;
  private readonly maxRatio: number;
  // 처리하는 prefix와 참조 조회. 디렉터리를 추가하면 조회 함수 없이는 컴파일되지 않음 (빠뜨리면 그 디렉터리 파일이 전부 고아로 보임)
  private readonly findReferencedKeys: Record<
    FileDirectory,
    (keys: string[]) => Promise<string[]>
  >;

  constructor(
    configService: ConfigService,
    private readonly fileService: FileService,
    private readonly slackService: SlackService,
    graduatedRepository: GraduatedRepository,
    studentProfileAttachmentRepository: StudentProfileAttachmentRepository,
  ) {
    // 첫 배포 안전을 위해 명시적으로 켜야 지움. 꺼져 있으면 후보를 로그로만 남김
    this.deleteEnabled =
      configService.get<string>("S3_ORPHAN_DELETE_ENABLED")?.trim() === "true";

    const rawMaxDeletes = configService
      .get<string>("S3_ORPHAN_MAX_DELETES")
      ?.trim();
    const maxDeletes = rawMaxDeletes
      ? Number(rawMaxDeletes)
      : DEFAULT_MAX_DELETES;
    if (!Number.isInteger(maxDeletes) || maxDeletes <= 0) {
      throw new Error("S3_ORPHAN_MAX_DELETES must be a positive integer.");
    }
    this.maxDeletes = maxDeletes;

    const rawMaxRatio = configService
      .get<string>("S3_ORPHAN_MAX_RATIO")
      ?.trim();
    const maxRatio = rawMaxRatio ? Number(rawMaxRatio) : DEFAULT_MAX_RATIO;
    if (!(maxRatio > 0 && maxRatio <= 1)) {
      throw new Error("S3_ORPHAN_MAX_RATIO must be greater than 0, at most 1.");
    }
    this.maxRatio = maxRatio;

    this.findReferencedKeys = {
      [FileDirectory.BUSINESS_CARD]: (keys) =>
        graduatedRepository.findExistingBusinessCardKeys(keys),
      [FileDirectory.ATTACHMENT]: (keys) =>
        studentProfileAttachmentRepository.findExistingFileKeys(keys),
    };
  }

  async cleanup(now: Date = new Date()): Promise<OrphanFileCleanupResult> {
    const scan = await this.scan(new Date(now.getTime() - ORPHAN_MIN_AGE_MS));
    const summary = {
      scanned: scan.scanned,
      orphans: scan.orphans,
      deleted: 0,
      failed: 0,
    };
    const stopReason = this.findStopReason(scan);

    if (!this.deleteEnabled) {
      if (stopReason) {
        this.logger.warn(`Dry run: would stop. ${stopReason}`);
      }
      return { ...summary, stopped: stopReason !== null };
    }

    if (stopReason) {
      await this.alert(`Orphan file cleanup stopped. ${stopReason}`);
      return { ...summary, stopped: true };
    }

    for (const key of scan.deletableKeys) {
      try {
        await this.fileService.deleteFile(key);
        this.logger.log(`Deleted orphan file ${key}`);
        summary.deleted++;
      } catch (e) {
        // DB에 참조가 없으므로 다음 실행에서 다시 후보가 됨
        this.logger.error(
          `Failed to delete orphan file ${key}: ${(e as Error).message}`,
        );
        summary.failed++;
      }
    }

    if (scan.orphans > this.maxDeletes) {
      await this.alert(
        `Orphan files exceed the limit: ${scan.orphans} found, up to ${this.maxDeletes} deleted per run. The rest will be deleted in later runs.`,
      );
    }
    return { ...summary, stopped: false };
  }

  private async scan(cutoff: Date): Promise<OrphanFileScan> {
    const result: OrphanFileScan = {
      scanned: 0,
      oldFiles: 0,
      orphans: 0,
      deletableKeys: [],
    };

    for (const directory of Object.values(FileDirectory)) {
      let token: string | undefined;
      do {
        const page = await this.fileService.listFiles(`${directory}/`, token);
        token = page.nextToken;
        result.scanned += page.files.length;

        const oldKeys = page.files
          .filter((f) => f.lastModified && f.lastModified <= cutoff)
          .map((f) => f.key);
        const referenced = new Set(
          await this.findReferencedKeys[directory](oldKeys),
        );
        const orphanKeys = oldKeys.filter((key) => !referenced.has(key));

        result.oldFiles += oldKeys.length;
        result.orphans += orphanKeys.length;
        if (this.deleteEnabled) {
          result.deletableKeys.push(
            ...orphanKeys.slice(
              0,
              this.maxDeletes - result.deletableKeys.length,
            ),
          );
        } else {
          // 배포 전 대조용. 상한과 상관없이 전부 남김
          for (const key of orphanKeys) {
            this.logger.log(`Dry run: orphan file ${key}`);
          }
        }
      } while (token);
    }
    return result;
  }

  // DB가 비었거나 다른 환경을 가리키면 쿼리는 성공하고 파일이 전부 고아로 보임. 버킷 버전 관리가 꺼져 있어 지우면 복구할 수 없으므로 지우지 않음
  private findStopReason(scan: OrphanFileScan): string | null {
    if (scan.orphans > 0 && scan.orphans === scan.oldFiles) {
      return `None of the ${scan.oldFiles} old file(s) are referenced by the DB. Check the DB and bucket settings.`;
    }
    if (
      scan.orphans >= RATIO_CHECK_MIN_ORPHANS &&
      scan.orphans / scan.oldFiles > this.maxRatio
    ) {
      return `${scan.orphans} of ${scan.oldFiles} old files are orphans, over the ratio ${this.maxRatio}. Check the DB and bucket settings. If this is expected, raise S3_ORPHAN_MAX_RATIO.`;
    }
    return null;
  }

  private async alert(message: string): Promise<void> {
    this.logger.error(message);
    await this.slackService
      .sendText(`*[S3 ORPHAN FILES]*\n${message}`, { channel: "bug" })
      .catch((err) => {
        this.logger.error("Failed to send Slack notification", err);
      });
  }
}
